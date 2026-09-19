import { afterAll, beforeAll, describe, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pregenerate_layers, validateLayers } from './generator-layers';
import { LayeredSolver as RefLayeredSolver } from './solver-layers';
import { LayeredSolver as AltLayeredSolver } from './solver-layers-alt';
import { SquareGrid } from './grids/squaregrid';
import { HexaGrid } from './grids/hexagrid';

const env = /** @type {any} */ (globalThis).process?.env || {};
// BENCH_SOLVER picks the benchmark target: alt (default, the alternative
// solver) or ref (the reference solver)
/** @type {Record<String, any>} */
const SOLVERS = {
	alt: AltLayeredSolver,
	ref: RefLayeredSolver
};
const SOLVER_NAME = SOLVERS[env.BENCH_SOLVER] ? env.BENCH_SOLVER : 'alt';
const LayeredSolver = SOLVERS[SOLVER_NAME];
const NUM_RUNS = Number(env.BENCH_MARK_AMBIGUOUS_RUNS) || 200;
// wall-clock cap on a single markAmbiguousTiles call, guarding against
// the heavy backtracking tail. Capped runs are recorded with capped: true
// and excluded from the elapsed/ambiguous statistics.
const WALL_CLOCK_CAP_MS = Number(env.BENCH_MARK_AMBIGUOUS_CAP_MS) || 60 * 1000;
const TIMEOUT_ERROR = 'benchmark wall-clock cap reached';
const OUTPUT_DIR = 'generator_stats';
const OUTPUT_SUFFIX = {
	alt: '',
	ref: '_ref'
}[SOLVER_NAME];
const OUTPUT_FILE = `${OUTPUT_DIR}/layered_mark_ambiguous_20x20${OUTPUT_SUFFIX}.json`;
const LAYERING = 0.6;
// long timeout, a single uncapped search can occasionally take minutes
const TIMEOUT = 2 * 60 * 60 * 1000;

/**
 * Percentile of a sorted number array
 * @param {Number[]} sorted - ascending
 * @param {Number} p - in [0, 1]
 * @returns {Number}
 */
function percentile(sorted, p) {
	if (sorted.length === 0) {
		return 0;
	}
	const index = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
	return sorted[index];
}

/**
 * Search work counters collected by the solver, shared across its clones
 * @typedef {Object} SolverStats
 * @property {Number} iterations - markAmbiguousTiles trial-loop iterations
 * @property {Number} trialClones - solver clones made for guess trials
 * @property {Number} shortTrials - single-picture probes of doShortTrials
 * @property {Number} dirtyProcessings - cells processed by processDirtyCells
 * @property {Number} prunedPictures - pictures deleted by pruning (contradictions and deadend pairs)
 */

/**
 * @typedef {Object} MarkRunRecord
 * @property {String} solver - which solver produced the record
 * @property {String} grid
 * @property {Number} width
 * @property {Number} height
 * @property {Boolean} wrap
 * @property {Number} layeringAmount
 * @property {Number} branchingAmount
 * @property {Number} avoidObvious
 * @property {Number} subCells
 * @property {Number} pregenerateMs
 * @property {Number} elapsedMs - markAmbiguousTiles time (time-to-abort when capped)
 * @property {Boolean} capped - true when the wall-clock cap aborted the search
 * @property {Number} numAmbiguous - -1 when capped (search did not finish)
 * @property {Number} ambiguousAtCap - last ambiguous count reported before the cap hit
 * @property {Boolean} unique
 * @property {Boolean|null} solvable - null when capped (unknown)
 * @property {Boolean} complete - false when capped
 * @property {Record<String, Number>} stats - search work counters (partial when capped)
 */

const STAT_KEYS = [
	'iterations',
	'trialClones',
	'shortTrials',
	'dirtyProcessings',
	'prunedPictures'
];

/**
 * Aggregated statistics of a set of runs
 * @typedef {Object} RunSummary
 * @property {Number} n
 * @property {Number} cappedCount
 * @property {{min: Number, mean: Number, p50: Number, p90: Number, p99: Number, max: Number}} elapsedMs
 * @property {{min: Number, max: Number}} cappedElapsedMs
 * @property {{min: Number, p50: Number, p90: Number, max: Number}} numAmbiguous
 * @property {Number} uniqueCount
 * @property {Number} unsolvableCount
 * @property {Record<String, {mean: Number, p50: Number, p90: Number, max: Number}>} stats
 */

/**
 * Summary statistics of a set of runs
 * @param {MarkRunRecord[]} runs
 * @returns {RunSummary}
 */
function summarize(runs) {
	const completed = runs.filter((r) => !r.capped);
	const capped = runs.filter((r) => r.capped);
	const times = completed.map((r) => r.elapsedMs).sort((a, b) => a - b);
	const ambiguous = completed.map((r) => r.numAmbiguous).sort((a, b) => a - b);
	const cappedTimes = capped.map((r) => r.elapsedMs);
	const mean = times.reduce((sum, t) => sum + t, 0) / (times.length || 1);
	return {
		n: runs.length,
		cappedCount: capped.length,
		elapsedMs: {
			min: times[0],
			mean,
			p50: percentile(times, 0.5),
			p90: percentile(times, 0.9),
			p99: percentile(times, 0.99),
			max: times[times.length - 1]
		},
		cappedElapsedMs: {
			min: cappedTimes.length > 0 ? Math.min(...cappedTimes) : 0,
			max: cappedTimes.length > 0 ? Math.max(...cappedTimes) : 0
		},
		numAmbiguous: {
			min: ambiguous[0],
			p50: percentile(ambiguous, 0.5),
			p90: percentile(ambiguous, 0.9),
			max: ambiguous[ambiguous.length - 1]
		},
		uniqueCount: completed.filter((r) => r.unique).length,
		unsolvableCount: runs.filter((r) => r.solvable === false).length,
		stats: Object.fromEntries(
			STAT_KEYS.map((key) => {
				const values = completed.map((r) => r.stats[key]).sort((a, b) => a - b);
				return [
					key,
					{
						mean: values.reduce((sum, v) => sum + v, 0) / (values.length || 1),
						p50: percentile(values, 0.5),
						p90: percentile(values, 0.9),
						max: values[values.length - 1]
					}
				];
			})
		)
	};
}

/** @type {MarkRunRecord[]} */
const allRuns = [];
const startedIso = new Date().toISOString();

/**
 * Writes all collected data so far, safe to call after every run
 */
function flush() {
	/** @type {Object.<String, RunSummary>} */
	const summary = {};
	for (const kind of ['square', 'hexagonal']) {
		const runs = allRuns.filter((r) => r.grid === kind);
		if (runs.length > 0) {
			summary[kind] = summarize(runs);
		}
	}
	mkdirSync(OUTPUT_DIR, { recursive: true });
	writeFileSync(
		OUTPUT_FILE,
		JSON.stringify(
			{
				description:
					'markAmbiguousTiles timings on fresh pregenerate_layers boards: 20x20 non-wrapping, ' +
					`solver ${SOLVER_NAME}, layering 0.6, branching random in [0, 1], ` +
					'avoidObvious random in [0, 0.5], ' +
					'ambiguousTilesLimit max(100, 0.1 * total) like the uniqueness loop, no iteration cap, ' +
					`wall-clock cap ${WALL_CLOCK_CAP_MS} ms (capped runs are excluded from statistics), ` +
					'stats are per-run solver work counters',
				seed: SEED,
				started: startedIso,
				written: new Date().toISOString(),
				summary,
				runs: allRuns
			},
			undefined,
			'\t'
		)
	);
}

/**
 * Prints the summary of one grid kind
 * @param {String} kind
 */
function printSummary(kind) {
	const s = summarize(allRuns.filter((r) => r.grid === kind));
	console.log(
		`[${kind}] elapsedMs (completed ${s.n - s.cappedCount}/${s.n}): ` + JSON.stringify(s.elapsedMs)
	);
	console.log(
		`[${kind}] capped: ${s.cappedCount}, cappedElapsedMs: ` + JSON.stringify(s.cappedElapsedMs)
	);
	console.log(`[${kind}] numAmbiguous: ` + JSON.stringify(s.numAmbiguous));
	console.log(`[${kind}] unique: ${s.uniqueCount}/${s.n - s.cappedCount}`);
	for (const key of STAT_KEYS) {
		console.log(`[${kind}] stats.${key}: ` + JSON.stringify(s.stats[key]));
	}
	console.log(
		`[${kind}] ms per dirtyProcessing: ` +
			(s.stats.dirtyProcessings.mean
				? (s.elapsedMs.mean / s.stats.dirtyProcessings.mean).toFixed(4)
				: 'n/a')
	);
}

const enabled = !!env.BENCH_MARK_AMBIGUOUS;
// paired-seed protocol: with BENCH_SEED set, Math.random is replaced by a
// seeded PRNG for the duration of the run so that two benchmark runs (e.g.
// before/after a solver change) see the identical board sequence - this
// also controls pregenerate_layers internals. Runs must stay
// single-threaded while the PRNG is installed; the original Math.random is
// restored in afterAll
const SEED = env.BENCH_SEED !== undefined && env.BENCH_SEED !== '' ? Number(env.BENCH_SEED) : null;

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

describe('Benchmark markAmbiguousTiles on layered 20x20 boards', () => {
	const originalRandom = Math.random;
	beforeAll(() => {
		if (SEED !== null) {
			Math.random = mulberry32(SEED);
		}
	});
	afterAll(() => {
		Math.random = originalRandom;
	});
	for (const [
		label,
		makeGrid
	] of /** @type {Array<[String, () => import('$lib/puzzle/grids/abstractgrid').AbstractGrid]>} */ ([
		['square', () => new SquareGrid(20, 20, false)],
		['hexagonal', () => new HexaGrid(20, 20, false)]
	])) {
		it.skipIf(!enabled)(
			`Times markAmbiguousTiles on ${NUM_RUNS} fresh ${label} 20x20 boards`,
			() => {
				const grid = makeGrid();
				for (let i = 1; i <= NUM_RUNS; i++) {
					const branchingAmount = Math.random();
					const avoidObvious = Math.random() * 0.5;
					const pregenerateStart = performance.now();
					const layers = pregenerate_layers(grid, LAYERING, branchingAmount, avoidObvious);
					const pregenerateMs = performance.now() - pregenerateStart;
					validateLayers(grid, layers);
					const solver = new LayeredSolver(layers, grid);
					const start = performance.now();
					// the callback runs once per search iteration, outside the
					// solver's internal try/catch, so a throw aborts the whole search
					const progress = /** @type {{value: {ambiguous: Number}|null}} */ ({ value: null });
					solver.progress_callback = (p) => {
						progress.value = p;
						if (performance.now() - start > WALL_CLOCK_CAP_MS) {
							throw new Error(TIMEOUT_ERROR);
						}
					};
					/** @type {MarkRunRecord} */
					const record = {
						solver: SOLVER_NAME,
						grid: grid.KIND,
						width: grid.width,
						height: grid.height,
						wrap: grid.wrap,
						layeringAmount: LAYERING,
						branchingAmount,
						avoidObvious,
						subCells: layers.reduce((n, cellLayers) => n + cellLayers.length, 0),
						pregenerateMs,
						elapsedMs: 0,
						capped: false,
						numAmbiguous: -1,
						ambiguousAtCap: -1,
						unique: false,
						solvable: null,
						complete: false,
						stats: {
							iterations: 0,
							trialClones: 0,
							shortTrials: 0,
							dirtyProcessings: 0,
							prunedPictures: 0
						}
					};
					try {
						// mirrors the generator's uniqueness loop: ambiguousLimit =
						// max(100, 0.1 * total), no solver iteration cap
						const { numAmbiguous, unique, solvable, complete } = solver.markAmbiguousTiles(
							Math.max(100, 0.1 * grid.total),
							0
						);
						record.elapsedMs = performance.now() - start;
						record.numAmbiguous = numAmbiguous;
						record.unique = unique;
						record.solvable = solvable;
						record.complete = complete;
						record.stats = { ...solver.stats };
					} catch (error) {
						if (/** @type {Error} */ (error).message !== TIMEOUT_ERROR) {
							throw error;
						}
						record.elapsedMs = performance.now() - start;
						record.capped = true;
						record.ambiguousAtCap = progress.value ? progress.value.ambiguous : -1;
						record.stats = { ...solver.stats };
					}
					allRuns.push(record);
					flush();
					if (record.capped) {
						console.warn(
							`[${grid.KIND}] run ${i}: capped after ${(record.elapsedMs / 1000).toFixed(1)} s, ` +
								`ambiguous at cap=${record.ambiguousAtCap}`
						);
					} else if (!record.solvable) {
						console.warn(`[${grid.KIND}] run ${i}: anomaly`, record);
					}
					if (i % 10 === 0) {
						console.log(
							`[${grid.KIND}] run ${i}/${NUM_RUNS}: ${(record.elapsedMs / 1000).toFixed(2)} s, ` +
								`ambiguous=${record.numAmbiguous}, unique=${record.unique}, capped=${record.capped}`
						);
					}
				}
				printSummary(grid.KIND);
			},
			TIMEOUT
		);
	}
});
