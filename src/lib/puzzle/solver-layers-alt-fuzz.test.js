import { afterAll, beforeAll, describe, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import {
	applyRotations,
	pregenerate_layers,
	randomRotate,
	validateLayers
} from './generator-layers';
import { LayeredSolver as RefLayeredSolver } from './solver-layers';
import { LayeredSolver as NoBudgetRefSolver } from './solver-layers-scratch-nobudget';
import { LayeredSolver as AltLayeredSolver } from './solver-layers-alt';
import { SquareGrid } from './grids/squaregrid';
import { HexaGrid } from './grids/hexagrid';

// Equivalence fuzz: compares the COMPLETE solution lists that the reference
// solver (solver-layers.js) and the alternative solver (solver-layers-alt.js)
// enumerate with solve(true) on fresh generated boards. The full solution set
// is a property of the board alone, so sound + complete solvers must produce
// identical sets - both dedupe pictures identically (same buildPossible), so
// solutions are comparable rotation arrays and only enumeration order can
// differ, hence set comparison.
//
// Extra checks per board:
// - every enumerated solution of both solvers must pass validateLayers;
// - when exactly one solution exists, markAmbiguousTiles on fresh instances
//   must report it exactly (marked == solution, unique, numAmbiguous 0,
//   solvable). Exact by design: the ambiguity overcount cascade needs a
//   first ambiguity to start from, which never exists on a unique board.
//
// On the first discrepancy the offending board is saved as a self-contained
// JSON reproducer into generator_stats/ and the test fails.
//
// Usage:
//   FUZZ_SOLUTIONS=1 npx vitest run src/lib/puzzle/solver-layers-alt-fuzz.test.js
// Optional environment:
//   FUZZ_SEED - seed for a reproducible board sequence (mulberry32 PRNG)
//   FUZZ_STABLE_RUNS - clean boards to spend at one ladder size before
//     escalating to the next (default 15)
//   FUZZ_CAP_MS - wall-clock cap per enumeration (default 15000)
//   FUZZ_MAX_SOLUTIONS - boards enumerating more solutions than this are
//     skipped, partial lists can not be compared (default 1000)

const env = /** @type {any} */ (globalThis).process?.env || {};
// FUZZ_REF_SCRATCH=1 points the reference side at the scratch ablation copy
// (edge budget throws disabled): any bogus solution surviving without the
// budget fails validateLayers or the solution-list comparison
/** @type {typeof RefLayeredSolver} */
const LayeredSolver = env.FUZZ_REF_SCRATCH ? NoBudgetRefSolver : RefLayeredSolver;
const enabled = !!env.FUZZ_SOLUTIONS;
const RUNS_PER_SIZE = Number(env.FUZZ_STABLE_RUNS) || 15;
const CAP_MS = Number(env.FUZZ_CAP_MS) || 15000;
const MAX_SOLUTIONS = Number(env.FUZZ_MAX_SOLUTIONS) || 1000;
const CAP_ERROR = 'fuzz wall-clock cap reached';
const SOLUTIONS_ERROR = 'fuzz solution count cap reached';
// a ladder size that keeps hitting the caps is abandoned after this many attempts
const MAX_RUNS_PER_SIZE = RUNS_PER_SIZE * 4;
const OUTPUT_DIR = 'generator_stats';
// generous timeout: a full ladder is sizes * RUNS_PER_SIZE boards,
// each capped at CAP_MS in the worst case
const TIMEOUT = 60 * 60 * 1000;

/**
 * A fuzz board source: a grid family with a ladder of sizes,
 * escalated through while no bugs are found
 * @typedef {Object} FuzzConfig
 * @property {String} label
 * @property {(width: Number, height: Number) => import('$lib/puzzle/grids/abstractgrid').AbstractGrid} makeGrid
 * @property {Number[][]} sizes - [width, height] pairs, small to large
 */

/** @type {FuzzConfig[]} */
const CONFIGS = [
	{
		label: 'square non-wrap',
		makeGrid: (width, height) => new SquareGrid(width, height, false),
		sizes: [
			[7, 7],
			[8, 8],
			[9, 9],
			[10, 10]
		]
	},
	{
		label: 'square wrap',
		makeGrid: (width, height) => new SquareGrid(width, height, true),
		sizes: [
			[4, 4],
			[5, 5],
			[6, 6],
			[7, 7]
		]
	},
	{
		label: 'hexa non-wrap',
		makeGrid: (width, height) => new HexaGrid(width, height, false),
		sizes: [
			[7, 6],
			[8, 7]
		]
	},
	{
		label: 'hexa wrap',
		makeGrid: (width, height) => new HexaGrid(width, height, true),
		sizes: [
			[4, 4],
			[5, 5],
			[6, 6]
		]
	}
];

/**
 * Result of a full solution enumeration
 * @typedef {Object} EnumResult
 * @property {Number[][]} solutions - one rotation array per solution
 * @property {Boolean} capped - true when a cap aborted the enumeration
 * @property {Number} elapsedMs
 */

/**
 * Deterministic PRNG (mulberry32)
 * @param {Number} seed
 * @returns {() => Number}
 */
function mulberry32(seed) {
	let a = seed >>> 0;
	return function () {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const SEED = env.FUZZ_SEED !== undefined && env.FUZZ_SEED !== '' ? Number(env.FUZZ_SEED) : null;

/**
 * Deep copy of layered tiles so every solver run gets its own board
 * @param {import('./generator-layers').LayeredTiles} tiles
 * @returns {import('./generator-layers').LayeredTiles}
 */
function copyTiles(tiles) {
	return tiles.map((cellLayers) => [...cellLayers]);
}

/**
 * Enumerates all solutions of a board with solve(true). The caps are
 * enforced in the consumer loop: solve() has no progress_callback, so the
 * only way to abort it is to stop pulling steps from the generator
 * @param {LayeredSolver|AltLayeredSolver} solver
 * @returns {EnumResult}
 */
function enumerate(solver) {
	const start = performance.now();
	try {
		for (const _step of solver.solve(true)) {
			if (performance.now() - start > CAP_MS) {
				throw new Error(CAP_ERROR);
			}
			if (solver.solutions.length > MAX_SOLUTIONS) {
				throw new Error(SOLUTIONS_ERROR);
			}
		}
		return {
			solutions: solver.solutions,
			capped: false,
			elapsedMs: performance.now() - start
		};
	} catch (error) {
		if (
			/** @type {Error} */ (error).message !== CAP_ERROR &&
			/** @type {Error} */ (error).message !== SOLUTIONS_ERROR
		) {
			throw error;
		}
		return {
			solutions: solver.solutions,
			capped: true,
			elapsedMs: performance.now() - start
		};
	}
}

/**
 * Lists the ways two complete solution lists disagree
 * @param {Number[][]} refSolutions
 * @param {Number[][]} altSolutions
 * @returns {String[]} - empty when the lists describe the same solution set
 */
function compareSolutionSets(refSolutions, altSolutions) {
	/** @type {String[]} */
	const diffs = [];
	if (refSolutions.length !== altSolutions.length) {
		diffs.push(`solution count: ref=${refSolutions.length} alt=${altSolutions.length}`);
	}
	/** @type {Set<String>} */
	const refKeys = new Set(refSolutions.map((solution) => solution.join(',')));
	/** @type {Set<String>} */
	const altKeys = new Set(altSolutions.map((solution) => solution.join(',')));
	const onlyRef = [...refKeys].filter((key) => !altKeys.has(key));
	const onlyAlt = [...altKeys].filter((key) => !refKeys.has(key));
	if (onlyRef.length > 0) {
		diffs.push(`${onlyRef.length} solutions only in ref, e.g. ${onlyRef.slice(0, 3).join(' | ')}`);
	}
	if (onlyAlt.length > 0) {
		diffs.push(`${onlyAlt.length} solutions only in alt, e.g. ${onlyAlt.slice(0, 3).join(' | ')}`);
	}
	return diffs;
}

/**
 * Checks that every enumerated solution is a valid layered board
 * @param {import('$lib/puzzle/grids/abstractgrid').AbstractGrid} grid
 * @param {import('./generator-layers').LayeredTiles} tiles - scrambled board as given to the solver
 * @param {Number[][]} solutions
 * @returns {String} - '' when all solutions are valid, otherwise the validation error
 */
function invalidSolution(grid, tiles, solutions) {
	for (const solution of solutions) {
		try {
			validateLayers(grid, applyRotations(grid, tiles, solution));
		} catch (error) {
			return /** @type {Error} */ (error).message;
		}
	}
	return '';
}

/**
 * Lists the ways a markAmbiguousTiles result disagrees with the unique
 * solution of the board
 * @param {String} name - which solver produced the result
 * @param {Number[]} solution - the enumerated unique solution
 * @param {{marked: Number[], solvable: Boolean, unique: Boolean, numAmbiguous: Number}} result
 * @returns {String[]} - empty when the result is exact
 */
function uniqueResultDiffs(name, solution, result) {
	/** @type {String[]} */
	const diffs = [];
	if (!result.solvable) {
		diffs.push(`${name} markAmbiguousTiles: solvable=false`);
	}
	if (result.unique !== true) {
		diffs.push(`${name} markAmbiguousTiles: unique=${result.unique}`);
	}
	if (result.numAmbiguous !== 0) {
		diffs.push(`${name} markAmbiguousTiles: numAmbiguous=${result.numAmbiguous}`);
	}
	for (let i = 0; i < solution.length; i++) {
		if (result.marked[i] !== solution[i]) {
			diffs.push(`${name} marked[${i}]: got ${result.marked[i]}, expected ${solution[i]}`);
		}
	}
	return diffs;
}

/**
 * Saves the discrepant board as a self-contained reproducer: rebuild the
 * grid from kind/width/height/wrap and run either solver on tiles
 * @param {import('$lib/puzzle/grids/abstractgrid').AbstractGrid} grid
 * @param {import('./generator-layers').LayeredTiles} tiles - scrambled board as given to both solvers
 * @param {Number} runIndex
 * @returns {String} - path of the written file
 */
function saveDiscrepancy(grid, tiles, runIndex) {
	const record = {
		grid: grid.KIND,
		width: grid.width,
		height: grid.height,
		wrap: grid.wrap,
		tiles
	};
	mkdirSync(OUTPUT_DIR, { recursive: true });
	const file = `${OUTPUT_DIR}/discrepancy_solutions_${grid.KIND}_${grid.width}x${grid.height}_wrap${grid.wrap}_run${runIndex}.json`;
	writeFileSync(file, JSON.stringify(record, undefined, '\t'));
	return file;
}

/**
 * Fuzzes one fresh board: generates, scrambles, enumerates all solutions
 * with both solvers and compares. Saves the board and throws on the first
 * discrepancy.
 * @param {import('$lib/puzzle/grids/abstractgrid').AbstractGrid} grid
 * @param {Number} runIndex - 1-based board counter, for logs and artifact names
 * @returns {String} 'ok' when comparable and identical, 'capped' when skipped
 */
function fuzzBoard(grid, runIndex) {
	const label = `${grid.KIND} ${grid.width}x${grid.height}${grid.wrap ? ' wrap' : ''}`;
	const layering = 0.5 + Math.random() * 0.3;
	const branching = Math.random();
	const avoidObvious = Math.random() * 0.5;
	const solvedTiles = pregenerate_layers(grid, layering, branching, avoidObvious);
	validateLayers(grid, solvedTiles);
	const tiles = randomRotate(solvedTiles, grid);

	const refResult = enumerate(new LayeredSolver(copyTiles(tiles), grid));
	const altResult = enumerate(new AltLayeredSolver(copyTiles(tiles), grid));

	if (refResult.capped || altResult.capped) {
		console.warn(
			`[${label}] run ${runIndex}: capped (ref=${refResult.capped}, alt=${altResult.capped}), skipped`
		);
		return 'capped';
	}
	console.log(
		`[${label}] run ${runIndex}: solutions ref=${refResult.solutions.length} ` +
			`alt=${altResult.solutions.length} (ref ${refResult.elapsedMs.toFixed(0)} ms, ` +
			`alt ${altResult.elapsedMs.toFixed(0)} ms)`
	);

	const diffs = compareSolutionSets(refResult.solutions, altResult.solutions);
	if (diffs.length === 0) {
		const refInvalid = invalidSolution(grid, tiles, refResult.solutions);
		if (refInvalid !== '') {
			diffs.push(`ref enumerated an invalid solution: ${refInvalid}`);
		}
		const altInvalid = invalidSolution(grid, tiles, altResult.solutions);
		if (altInvalid !== '') {
			diffs.push(`alt enumerated an invalid solution: ${altInvalid}`);
		}
	}
	// unique boards: markAmbiguousTiles must report the one solution exactly
	if (diffs.length === 0 && refResult.solutions.length === 1) {
		const solution = refResult.solutions[0];
		const refMark = new LayeredSolver(copyTiles(tiles), grid).markAmbiguousTiles(0);
		const altMark = new AltLayeredSolver(copyTiles(tiles), grid).markAmbiguousTiles(0);
		diffs.push(...uniqueResultDiffs('ref', solution, refMark));
		diffs.push(...uniqueResultDiffs('alt', solution, altMark));
	}

	if (diffs.length > 0) {
		const file = saveDiscrepancy(grid, tiles, runIndex);
		console.error(`[${label}] run ${runIndex}: DISCREPANCY, board saved to ${file}`);
		for (let diff of diffs) {
			console.error(`  ${diff}`);
		}
		throw new Error(
			`solution list mismatch between solver-layers-alt and solver-layers ` +
				`on ${label}, board saved to ${file}`
		);
	}
	return 'ok';
}

describe('Fuzz solve(true) solution lists: solver-layers-alt vs solver-layers', () => {
	const originalRandom = Math.random;
	// paired-seed protocol: with FUZZ_SEED set, Math.random is replaced by a
	// seeded PRNG for the duration of the run so the board sequence is
	// reproducible; pregenerate_layers and randomRotate both consume it
	beforeAll(() => {
		if (SEED !== null) {
			Math.random = mulberry32(SEED);
		}
	});
	afterAll(() => {
		Math.random = originalRandom;
	});

	let totalRuns = 0;

	for (const config of CONFIGS) {
		it.skipIf(!enabled)(
			`Fuzz ${config.label}: ${RUNS_PER_SIZE} clean boards per size before escalating`,
			() => {
				for (let sizeIndex = 0; sizeIndex < config.sizes.length; sizeIndex++) {
					const [width, height] = config.sizes[sizeIndex];
					const grid = config.makeGrid(width, height);
					let clean = 0;
					let runs = 0;
					while (clean < RUNS_PER_SIZE && runs < MAX_RUNS_PER_SIZE) {
						runs += 1;
						totalRuns += 1;
						if (fuzzBoard(grid, totalRuns) === 'ok') {
							clean += 1;
						}
					}
					if (clean < RUNS_PER_SIZE) {
						console.warn(
							`[${config.label}] size ${width}x${height}: only ${clean}/${RUNS_PER_SIZE} ` +
								`clean boards after ${runs} runs (too many caps), moving on`
						);
					} else if (sizeIndex < config.sizes.length - 1) {
						console.log(
							`[${config.label}] size ${width}x${height}: ${clean} clean boards, escalating`
						);
					}
				}
			},
			TIMEOUT
		);
	}
});
