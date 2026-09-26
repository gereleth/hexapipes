// CPU-profiler driver for markAmbiguousTiles on a single reproducible board.
// See agent-doc/solver-perf-plan.md, Phase 0.
//
// Usage:
//   BENCH_SEED=<seed> npx vite-node scratch/profile-driver.mjs <square|hexa> <index> [reps=3] [intervalUs=100]
//
// Replays the paired benchmark's exact board sequence (same mulberry32
// protocol and draw order as solver-layers-stats.test.js: one warmup board
// per grid, then per board branching = Math.random(), avoidObvious =
// Math.random() * 0.5, pregenerate_layers(grid, 0.6, b, a); square grids
// first, then hexagonal). Cross-checks verdict + work counters of the
// replayed board against the candidate side of
// generator_stats/layered_mark_ambiguous_20x20_paired.json - a mismatch
// dumps the replayed tiles as a JSON reproducer and exits non-zero.
// Then profiles `reps` fresh-solver markAmbiguousTiles runs via the
// inspector Profiler domain (only the reps loop is sampled, so module
// loading and board replay stay out of the profile) and writes the
// .cpuprofile next to this script's log in /tmp/opencode/prof.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import inspector from 'node:inspector';
import { pregenerate_layers, validateLayers } from '../src/lib/puzzle/generator-layers.js';
import { LayeredSolver } from '../src/lib/puzzle/solver-layers.js';
import { SquareGrid } from '../src/lib/puzzle/grids/squaregrid.js';
import { HexaGrid } from '../src/lib/puzzle/grids/hexagrid.js';

const env = process.env;
const SEED = Number(env.BENCH_SEED);
if (!env.BENCH_SEED || Number.isNaN(SEED)) {
	console.error('BENCH_SEED is required (must match the paired benchmark run to compare against)');
	process.exit(1);
}
const NUM_RUNS = Number(env.BENCH_MARK_AMBIGUOUS_RUNS) || 200;
const LAYERING = 0.6;
const PAIRED_JSON = 'generator_stats/layered_mark_ambiguous_20x20_paired.json';
const PROFILE_DIR = '/tmp/opencode/prof';

const [kindArg, indexArg, repsArg, intervalArg] = process.argv.slice(2);
const KIND = kindArg === 'hexa' ? 'hexagonal' : kindArg === 'square' ? 'square' : null;
if (!KIND) {
	console.error(
		'usage: scratch/profile-driver.mjs <square|hexa> <boardIndex0based> [reps=3] [intervalUs=100]'
	);
	process.exit(1);
}
const index = Number(indexArg);
const reps = Number(repsArg ?? 3);
const intervalUs = Number(intervalArg ?? 100);
if (!Number.isInteger(index) || index < 0 || index >= NUM_RUNS) {
	console.error(`boardIndex must be an integer in [0, ${NUM_RUNS})`);
	process.exit(1);
}

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

/**
 * One untimed markAmbiguousTiles run on a fresh solver, mirroring the
 * benchmark's call (ambiguousLimit = max(100, 0.1 * total))
 * @param {import('../src/lib/puzzle/solver-layers.js').LayeredSolver} SolverClass
 * @param {Number[][]} layers
 * @param {import('../src/lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
 */
function runOnce(SolverClass, layers, grid) {
	const solver = new SolverClass(layers, grid);
	const result = solver.markAmbiguousTiles(Math.max(100, 0.1 * grid.total));
	return { ...result, stats: { ...solver.stats } };
}

// paired-seed protocol: same PRNG swap as the benchmark, so the board
// sequence is identical for the same seed
Math.random = mulberry32(SEED);

/** @type {Array<[String, () => import('../src/lib/puzzle/grids/abstractgrid.js').AbstractGrid]>} */
const grids = [
	['square', () => new SquareGrid(20, 20, false)],
	['hexagonal', () => new HexaGrid(20, 20, false)]
];

/** @type {{layers: Number[][], grid: any, branching: Number, avoid: Number}|null} */
let target = null;
let skipped = 0;
for (const [kind, makeGrid] of grids) {
	const grid = makeGrid();
	// warmup board, exactly like the benchmark
	pregenerate_layers(grid, LAYERING, 0.5, 0.25);
	for (let i = 0; i < NUM_RUNS; i++) {
		const branchingAmount = Math.random();
		const avoidObvious = Math.random() * 0.5;
		if (kind !== KIND || i !== index) {
			pregenerate_layers(grid, LAYERING, branchingAmount, avoidObvious);
			skipped += 1;
			continue;
		}
		const layers = pregenerate_layers(grid, LAYERING, branchingAmount, avoidObvious);
		validateLayers(grid, layers);
		target = { layers, grid, branching: branchingAmount, avoid: avoidObvious };
	}
	if (target) break;
}
if (!target) {
	console.error(`board ${KIND}[${index}] not reached (bug in replay logic)`);
	process.exit(1);
}
const { layers, grid } = target;
console.log(
	`replayed ${KIND}[${index}] (${skipped} boards skipped): subCells ` +
		`${layers.reduce((n, c) => n + c.length, 0)}, branching ${target.branching.toFixed(3)}, ` +
		`avoidObvious ${target.avoid.toFixed(3)}`
);

// cross-check against the paired benchmark record for this board
const paired = JSON.parse(readFileSync(PAIRED_JSON, 'utf8'));
if (paired.seed !== SEED) {
	console.error(`paired JSON seed ${paired.seed} != BENCH_SEED ${SEED}`);
	process.exit(1);
}
const record = paired.runs.filter((/** @type {any} */ r) => r.grid === KIND)[index];
if (!record) {
	console.error(`no paired record for ${KIND}[${index}] (run the benchmark first)`);
	process.exit(1);
}
if (record.candidate.capped || record.baseline.capped) {
	console.error(`board ${KIND}[${index}] was capped in the paired run, pick an uncapped board`);
	process.exit(1);
}
const check = runOnce(LayeredSolver, layers, grid);
const statKeys = ['iterations', 'trialClones', 'shortTrials', 'dirtyProcessings'];
const mismatches = [];
if (check.numAmbiguous !== record.candidate.numAmbiguous) {
	mismatches.push(`numAmbiguous ${check.numAmbiguous} != ${record.candidate.numAmbiguous}`);
}
if (check.unique !== record.candidate.unique)
	mismatches.push(`unique ${check.unique} != ${record.candidate.unique}`);
if (check.solvable !== record.candidate.solvable) {
	mismatches.push(`solvable ${check.solvable} != ${record.candidate.solvable}`);
}
for (const key of statKeys) {
	if (check.stats[key] !== record.candidate.stats[key]) {
		mismatches.push(`${key} ${check.stats[key]} != ${record.candidate.stats[key]}`);
	}
}
if (mismatches.length > 0) {
	const dumpPath = `generator_stats/profile_replay_mismatch_${KIND}_${index}.json`;
	writeFileSync(
		dumpPath,
		JSON.stringify(
			{
				grid: KIND,
				width: grid.width,
				height: grid.height,
				wrap: grid.wrap,
				layeringAmount: LAYERING,
				branchingAmount: target.branching,
				avoidObvious: target.avoid,
				tiles: layers
			},
			undefined,
			'\t'
		)
	);
	console.error(`REPLAY MISMATCH on ${KIND}[${index}]: ${mismatches.join('; ')}`);
	console.error(`tiles dumped to ${dumpPath} for diffing`);
	process.exit(1);
}
console.log(`replay verified against ${basename(PAIRED_JSON)}: verdicts and counters match`);

// profile only the reps loop, so replay/startup noise stays out
const session = new inspector.Session();
session.connect();
/**
 * @param {String} method
 * @param {Object} [params]
 * @returns {Promise<any>}
 */
const post = (method, params) =>
	new Promise((resolve, reject) =>
		session.post(method, params, (/** @type {Error|null} */ err, /** @type {any} */ result) =>
			err ? reject(err) : resolve(result)
		)
	);
await post('Profiler.enable');
await post('Profiler.setSamplingInterval', { interval: intervalUs });

mkdirSync(PROFILE_DIR, { recursive: true });
const profilePath = `${PROFILE_DIR}/${KIND}-${index}.cpuprofile`;
await post('Profiler.start');
for (let r = 0; r < reps; r++) {
	const start = performance.now();
	const result = runOnce(LayeredSolver, layers, grid);
	const ms = performance.now() - start;
	console.log(
		`rep ${r + 1}/${reps}: ${ms.toFixed(1)} ms, numAmbiguous ${result.numAmbiguous}, ` +
			`unique ${result.unique}, solvable ${result.solvable}, ` +
			`counters ${JSON.stringify(result.stats)}`
	);
}
const { profile } = await post('Profiler.stop');
writeFileSync(profilePath, JSON.stringify(profile));
console.log(`profile written to ${profilePath} (${reps} reps, ${intervalUs} us sampling)`);
