import { describe, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Generator } from './generator';
import { Solver } from './solver';
import { SquareGrid } from './grids/squaregrid';
import { HexaGrid } from './grids/hexagrid';

const env = /** @type {any} */ (globalThis).process?.env || {};
const NUM_RUNS = Number(env.BENCH_MARK_AMBIGUOUS_RUNS) || 100;
// wall-clock cap on a single markAmbiguousTiles call, guarding against
// heavy backtracking tails. Capped runs are recorded with capped: true
// and excluded from the elapsed/ambiguous statistics.
const WALL_CLOCK_CAP_MS = Number(env.BENCH_MARK_AMBIGUOUS_CAP_MS) || 60 * 1000;
const TIMEOUT_ERROR = 'benchmark wall-clock cap reached';
const OUTPUT_DIR = 'generator_stats';
const OUTPUT_FILE = `${OUTPUT_DIR}/classic_mark_ambiguous_30x30.json`;
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
 */

/**
 * @typedef {Object} ClassicMarkRunRecord
 * @property {String} grid
 * @property {Number} width
 * @property {Number} height
 * @property {Boolean} wrap
 * @property {Number} branchingAmount
 * @property {Number} avoidObvious
 * @property {Number} avoidStraights
 * @property {Number} tileCount
 * @property {Number} pregenerateMs
 * @property {Number} elapsedMs - markAmbiguousTiles time (time-to-abort when capped)
 * @property {Boolean} capped - true when the wall-clock cap aborted the search
 * @property {Number} numAmbiguous - -1 when capped (search did not finish)
 * @property {Number} ambiguousAtCap - last ambiguous count reported before the cap hit
 * @property {Boolean} unique
 * @property {Boolean|null} solvable - null when capped (unknown)
 * @property {Record<String, Number>} stats - search work counters (partial when capped)
 */

const STAT_KEYS = ['iterations', 'trialClones', 'shortTrials', 'dirtyProcessings'];

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
 * @param {ClassicMarkRunRecord[]} runs
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

/** @type {ClassicMarkRunRecord[]} */
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
					'markAmbiguousTiles timings on fresh pregenerate_growingtree boards: 30x30 non-wrapping, ' +
					'branching random in [0, 1], avoidObvious random in [0, 0.5], avoidStraights random in [0, 0.5], ' +
					'ambiguousTilesLimit max(100, 0.1 * total) like the uniqueness loop, no iteration cap, ' +
					`wall-clock cap ${WALL_CLOCK_CAP_MS} ms (capped runs are excluded from statistics). ` +
					'Classic control for solver-layers-stats.test.js (30x30 compensates layered puzzles being harder at equal grid size), ' +
					'stats are per-run solver work counters',
				started: startedIso,
				written: new Date().toISOString(),
				runs: allRuns,
				summary
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

const enabled = !!env.BENCH_MARK_AMBIGUOUS_CLASSIC;

describe('Benchmark markAmbiguousTiles on classic 30x30 boards', () => {
	for (const [
		label,
		makeGrid
	] of /** @type {Array<[String, () => import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid]>} */ ([
		['square', () => new SquareGrid(30, 30, false)],
		['hexagonal', () => new HexaGrid(30, 30, false)]
	])) {
		it.skipIf(!enabled)(
			`Times markAmbiguousTiles on ${NUM_RUNS} fresh ${label} 30x30 boards`,
			() => {
				const grid = makeGrid();
				const gen = new Generator(grid);
				for (let i = 1; i <= NUM_RUNS; i++) {
					const branchingAmount = Math.random();
					const avoidObvious = Math.random() * 0.5;
					const avoidStraights = Math.random() * 0.5;
					const pregenerateStart = performance.now();
					const tiles = gen.pregenerate_growingtree(branchingAmount, avoidObvious, avoidStraights);
					const pregenerateMs = performance.now() - pregenerateStart;
					const solver = new Solver(tiles, grid);
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
					/** @type {ClassicMarkRunRecord} */
					const record = {
						grid: grid.KIND,
						width: grid.width,
						height: grid.height,
						wrap: grid.wrap,
						branchingAmount,
						avoidObvious,
						avoidStraights,
						tileCount: grid.total - grid.emptyCells.size,
						pregenerateMs,
						elapsedMs: 0,
						capped: false,
						numAmbiguous: -1,
						ambiguousAtCap: -1,
						unique: false,
						solvable: null,
						stats: { iterations: 0, trialClones: 0, shortTrials: 0, dirtyProcessings: 0 }
					};
					try {
						// mirrors the generator's uniqueness loop: ambiguousLimit =
						// max(100, 0.1 * total), classic search has no iteration cap
						const { numAmbiguous, unique, solvable } = solver.markAmbiguousTiles(
							Math.max(100, 0.1 * grid.total)
						);
						record.elapsedMs = performance.now() - start;
						record.numAmbiguous = numAmbiguous;
						record.unique = unique;
						record.solvable = solvable;
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
