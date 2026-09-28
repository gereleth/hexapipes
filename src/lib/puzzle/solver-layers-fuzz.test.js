import { afterAll, beforeAll, describe, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import {
	applyRotations,
	pregenerate_layers,
	randomRotate,
	validateLayers
} from './generator-layers';
import { LayeredSolver as AltLayeredSolver } from './solver-layers';
import { SquareGrid } from './grids/squaregrid';
import { HexaGrid } from './grids/hexagrid';

// Equivalence fuzz: compares the COMPLETE solution lists that the baseline
// snapshot (solver-layers-baseline.js, an untracked frozen copy of
// solver-layers.js from the start of the optimization series) and the
// current solver (solver-layers.js) enumerate with solve(true) on fresh
// generated boards. The full solution set is a property of the board alone,
// so sound + complete solvers must produce identical sets - both dedupe
// pictures identically (same buildPossible), so solutions are comparable
// rotation arrays and only enumeration order can differ, hence set comparison.
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
// The baseline file is untracked, so a fresh checkout may not have it; the
// loader below fails with creation instructions instead of a cryptic
// import error.
//
// Usage:
//   FUZZ_SOLUTIONS=1 npx vitest run src/lib/puzzle/solver-layers-fuzz.test.js
// Optional environment:
//   FUZZ_SEED - seed for a reproducible board sequence (mulberry32 PRNG)
//   FUZZ_STABLE_RUNS - clean boards to spend at one ladder size before
//     escalating to the next (default 15)
//   FUZZ_CAP_MS - wall-clock cap per enumeration (default 15000)
//   FUZZ_MAX_SOLUTIONS - boards enumerating more solutions than this are
//     skipped, partial lists can not be compared (default 1000)

const env = /** @type {any} */ (globalThis).process?.env || {};
const enabled = !!env.FUZZ_SOLUTIONS;

/**
 * Loads the baseline solver snapshot. The snapshot is an untracked scratch
 * file (a verbatim copy of solver-layers.js frozen at the start of the
 * optimization series), so it may be missing on a fresh checkout
 * @returns {Promise<typeof import('./solver-layers').LayeredSolver>}
 */
async function loadBaselineSolver() {
	try {
		// computed specifier + @vite-ignore keep the import runtime-only, so a
		// missing file reaches the catch below instead of failing module resolution
		const module = await import(/* @vite-ignore */ './solver-layers-baseline'.concat(''));
		return module.LayeredSolver;
	} catch (error) {
		throw new Error(
			'Baseline solver snapshot is missing or cannot be imported.\n' +
				'Expected file: src/lib/puzzle/solver-layers-baseline.js - a verbatim copy of\n' +
				'solver-layers.js frozen at the start of the optimization series\n' +
				'(see agent-doc/solver-perf-plan.md, "Reference snapshot").\n' +
				'Create it with:\n' +
				'\tcp src/lib/puzzle/solver-layers.js src/lib/puzzle/solver-layers-baseline.js\n' +
				`Original error: ${/** @type {Error} */ (error).message}`
		);
	}
}
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
 * @param {import('./solver-layers').LayeredSolver} solver
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
 * @param {Number[][]} baselineSolutions
 * @param {Number[][]} currentSolutions
 * @returns {String[]} - empty when the lists describe the same solution set
 */
function compareSolutionSets(baselineSolutions, currentSolutions) {
	/** @type {String[]} */
	const diffs = [];
	if (baselineSolutions.length !== currentSolutions.length) {
		diffs.push(
			`solution count: baseline=${baselineSolutions.length} current=${currentSolutions.length}`
		);
	}
	/** @type {Set<String>} */
	const baselineKeys = new Set(baselineSolutions.map((solution) => solution.join(',')));
	/** @type {Set<String>} */
	const currentKeys = new Set(currentSolutions.map((solution) => solution.join(',')));
	const onlyBaseline = [...baselineKeys].filter((key) => !currentKeys.has(key));
	const onlyCurrent = [...currentKeys].filter((key) => !baselineKeys.has(key));
	if (onlyBaseline.length > 0) {
		diffs.push(
			`${onlyBaseline.length} solutions only in baseline, e.g. ${onlyBaseline.slice(0, 3).join(' | ')}`
		);
	}
	if (onlyCurrent.length > 0) {
		diffs.push(
			`${onlyCurrent.length} solutions only in current, e.g. ${onlyCurrent.slice(0, 3).join(' | ')}`
		);
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
 * @param {typeof import('./solver-layers').LayeredSolver} BaselineSolver
 * @returns {String} 'ok' when comparable and identical, 'capped' when skipped
 */
function fuzzBoard(grid, runIndex, BaselineSolver) {
	const label = `${grid.KIND} ${grid.width}x${grid.height}${grid.wrap ? ' wrap' : ''}`;
	const layering = 0.5 + Math.random() * 0.3;
	const branching = Math.random();
	const avoidObvious = Math.random() * 0.5;
	const solvedTiles = pregenerate_layers(grid, layering, branching, avoidObvious);
	validateLayers(grid, solvedTiles);
	const tiles = randomRotate(solvedTiles, grid);

	const baselineSolver = new BaselineSolver(copyTiles(tiles), grid);
	const currentSolver = new AltLayeredSolver(copyTiles(tiles), grid);
	const baselineResult = enumerate(baselineSolver);
	const currentResult = enumerate(currentSolver);

	if (baselineResult.capped || currentResult.capped) {
		console.warn(
			`[${label}] run ${runIndex}: capped (baseline=${baselineResult.capped}, ` +
				`current=${currentResult.capped}), skipped`
		);
		return 'capped';
	}
	// registry invariants of the current solver after a full enumeration
	currentSolver.components.validate();
	console.log(
		`[${label}] run ${runIndex}: solutions baseline=${baselineResult.solutions.length} ` +
			`current=${currentResult.solutions.length} (baseline ${baselineResult.elapsedMs.toFixed(0)} ms, ` +
			`current ${currentResult.elapsedMs.toFixed(0)} ms)`
	);

	const diffs = compareSolutionSets(baselineResult.solutions, currentResult.solutions);
	if (diffs.length === 0) {
		const baselineInvalid = invalidSolution(grid, tiles, baselineResult.solutions);
		if (baselineInvalid !== '') {
			diffs.push(`baseline enumerated an invalid solution: ${baselineInvalid}`);
		}
		const currentInvalid = invalidSolution(grid, tiles, currentResult.solutions);
		if (currentInvalid !== '') {
			diffs.push(`current enumerated an invalid solution: ${currentInvalid}`);
		}
	}
	// unique boards: markAmbiguousTiles must report the one solution exactly
	if (diffs.length === 0 && baselineResult.solutions.length === 1) {
		const solution = baselineResult.solutions[0];
		const baselineMark = new BaselineSolver(copyTiles(tiles), grid).markAmbiguousTiles(0);
		const currentMarkSolver = new AltLayeredSolver(copyTiles(tiles), grid);
		const currentMark = currentMarkSolver.markAmbiguousTiles(0);
		currentMarkSolver.components.validate();
		diffs.push(...uniqueResultDiffs('baseline', solution, baselineMark));
		diffs.push(...uniqueResultDiffs('current', solution, currentMark));
	}

	if (diffs.length > 0) {
		const file = saveDiscrepancy(grid, tiles, runIndex);
		console.error(`[${label}] run ${runIndex}: DISCREPANCY, board saved to ${file}`);
		for (let diff of diffs) {
			console.error(`  ${diff}`);
		}
		throw new Error(
			`solution list mismatch between solver-layers and its baseline snapshot ` +
				`(solver-layers-baseline.js) on ${label}, board saved to ${file}`
		);
	}
	return 'ok';
}

describe('Fuzz solve(true) solution lists: solver-layers vs baseline snapshot', () => {
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
			async () => {
				const BaselineSolver = await loadBaselineSolver();
				for (let sizeIndex = 0; sizeIndex < config.sizes.length; sizeIndex++) {
					const [width, height] = config.sizes[sizeIndex];
					const grid = config.makeGrid(width, height);
					let clean = 0;
					let runs = 0;
					while (clean < RUNS_PER_SIZE && runs < MAX_RUNS_PER_SIZE) {
						runs += 1;
						totalRuns += 1;
						if (fuzzBoard(grid, totalRuns, BaselineSolver) === 'ok') {
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
