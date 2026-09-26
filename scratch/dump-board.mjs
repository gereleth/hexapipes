// Dumps boards of the paired benchmark sequence as JSON for offline study.
// Usage:
//   BENCH_SEED=<seed> npx vite-node scratch/dump-board.mjs <square|hexa> <index>[,index...] [outPath]
// Replays the exact PRNG draw order of solver-layers-stats.test.js, verifies
// each replay against the paired benchmark record (verdict + counters), then
// writes the scrambled tiles as handed to LayeredSolver, plus a fresh
// re-scramble (randomRotate, seeded) with its own solve facts.
import { writeFileSync, readFileSync } from 'node:fs';
import {
	pregenerate_layers,
	validateLayers,
	randomRotate
} from '../src/lib/puzzle/generator-layers.js';
import { LayeredSolver } from '../src/lib/puzzle/solver-layers.js';
import { SquareGrid } from '../src/lib/puzzle/grids/squaregrid.js';
import { HexaGrid } from '../src/lib/puzzle/grids/hexagrid.js';

const SEED = Number(process.env.BENCH_SEED);
if (!SEED) {
	console.error('BENCH_SEED is required');
	process.exit(1);
}
const NUM_RUNS = Number(process.env.BENCH_MARK_AMBIGUOUS_RUNS) || 200;
const LAYERING = 0.6;
const PAIRED_JSON = 'generator_stats/layered_mark_ambiguous_20x20_paired.json';

const [kindArg, indexArg, outArg] = process.argv.slice(2);
const KIND = kindArg === 'hexa' ? 'hexagonal' : kindArg === 'square' ? 'square' : null;
if (!KIND || indexArg === undefined) {
	console.error('usage: scratch/dump-board.mjs <square|hexa> <index0based[,index...]> [outPath]');
	process.exit(1);
}
const indices = indexArg.split(',').map(Number);
if (indices.some((i) => !Number.isInteger(i) || i < 0 || i >= NUM_RUNS)) {
	console.error(`indices must be integers in [0, ${NUM_RUNS})`);
	process.exit(1);
}
const wanted = new Set(indices);

/**
 * Deterministic PRNG (mulberry32), verbatim from solver-layers-stats.test.js
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

Math.random = mulberry32(SEED);

/** @type {Array<[String, () => any]>} */
const grids = [
	['square', () => new SquareGrid(20, 20, false)],
	['hexagonal', () => new HexaGrid(20, 20, false)]
];

/** @type {Map<Number, {layers: Number[][], grid: any, branching: Number, avoid: Number}>} */
const targets = new Map();
for (const [kind, makeGrid] of grids) {
	const grid = makeGrid();
	pregenerate_layers(grid, LAYERING, 0.5, 0.25);
	for (let i = 0; i < NUM_RUNS; i++) {
		const branchingAmount = Math.random();
		const avoidObvious = Math.random() * 0.5;
		if (kind !== KIND || !wanted.has(i)) {
			pregenerate_layers(grid, LAYERING, branchingAmount, avoidObvious);
			continue;
		}
		const layers = pregenerate_layers(grid, LAYERING, branchingAmount, avoidObvious);
		validateLayers(grid, layers);
		targets.set(i, { layers, grid, branching: branchingAmount, avoid: avoidObvious });
	}
}
if (targets.size !== indices.length) {
	console.error(`requested ${indices.length} boards, replayed ${targets.size}`);
	process.exit(1);
}

const paired = JSON.parse(readFileSync(PAIRED_JSON, 'utf8'));
for (const index of indices) {
	const { layers, grid } = targets.get(index);
	const record = paired.runs.filter((/** @type {any} */ r) => r.grid === KIND)[index];
	const solver = new LayeredSolver(layers, grid);
	const result = solver.markAmbiguousTiles(Math.max(100, 0.1 * grid.total));
	const stats = { ...solver.stats };
	const check = record
		? result.numAmbiguous === record.candidate.numAmbiguous &&
			result.unique === record.candidate.unique &&
			result.solvable === record.candidate.solvable &&
			['iterations', 'trialClones', 'shortTrials', 'dirtyProcessings'].every(
				(key) => stats[key] === record.candidate.stats[key]
			)
			? 'verified'
			: 'MISMATCH against paired record'
		: 'no paired record to verify against';
	if (check === 'MISMATCH against paired record') {
		console.error(check);
		process.exit(1);
	}

	// fresh randomRotate scramble of the solved-orientation benchmark tiles;
	// still under the seeded PRNG, so it is reproducible for (seed, kind, index).
	// NOT invariant: rotation offsets change which possible entry satisfies
	// grid-space constraints, so the search path (and cost) differs
	const scrambledTiles = randomRotate(layers, grid);
	const scrambledSolver = new LayeredSolver(scrambledTiles, grid);
	const scrambledResult = scrambledSolver.markAmbiguousTiles(Math.max(100, 0.1 * grid.total));

	const layerHistogram = {};
	for (const cellLayers of layers) {
		layerHistogram[cellLayers.length] = (layerHistogram[cellLayers.length] || 0) + 1;
	}
	const outPath = outArg ?? `generator_stats/board_${KIND}_${index}_seed${SEED}.json`;
	writeFileSync(
		outPath,
		JSON.stringify(
			{
				description: `Board ${KIND}[${index}] of the paired benchmark sequence (seed ${SEED}): tiles = fresh randomRotate scramble (UI-importable); benchmarkTiles = pregenerate_layers output in solved orientation (replay-verified); each tiles field has its own solve facts`,
				grid: KIND,
				width: grid.width,
				height: grid.height,
				wrap: grid.wrap,
				numDirections: grid.NUM_DIRECTIONS,
				layeringAmount: LAYERING,
				branchingAmount: targets.get(index).branching,
				avoidObvious: targets.get(index).avoid,
				replay: check,
				run: {
					numAmbiguous: scrambledResult.numAmbiguous,
					unique: scrambledResult.unique,
					solvable: scrambledResult.solvable,
					stats: { ...scrambledSolver.stats }
				},
				benchmarkRun: {
					numAmbiguous: result.numAmbiguous,
					unique: result.unique,
					solvable: result.solvable,
					stats
				},
				subCells: layers.reduce((n, c) => n + c.length, 0),
				cellsWithLayers: layers.filter((c) => c.length > 0).length,
				layerCountHistogram: layerHistogram,
				tiles: scrambledTiles,
				benchmarkTiles: layers
			},
			undefined,
			'\t'
		)
	);
	console.log(
		`dumped ${outPath}: subCells ${layers.reduce((n, c) => n + c.length, 0)}, ` +
			`layerCountHistogram ${JSON.stringify(layerHistogram)}, replay ${check}; ` +
			`scrambled run: numAmbiguous ${scrambledResult.numAmbiguous}, unique ${scrambledResult.unique}, ` +
			`iterations ${scrambledSolver.stats.iterations}, trialClones ${scrambledSolver.stats.trialClones}`
	);
}
