import { afterAll, beforeAll, describe, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pregenerate_layers, validateLayers } from './generator-layers';
import { LayeredSolver as AltLayeredSolver } from './solver-layers-alt';
import { SquareGrid } from './grids/squaregrid';
import { HexaGrid } from './grids/hexagrid';

// Paired benchmark: every board is solved twice, back-to-back, by the
// baseline snapshot (solver-layers-baseline.js, an untracked frozen copy of
// solver-layers-alt.js) and the current solver (solver-layers-alt.js).
// Because both solves share the same process state, the comparison is much
// less affected by whatever else the machine is doing than cross-session
// wall-clock comparisons. The run order alternates per board index to cancel
// residual JIT/GC ordering bias, and one throwaway warmup board per grid
// gets both solvers hot before anything is recorded.
//
// Per board the run also compares the two solvers' verdicts and work
// counters (agree.* flags): verdict disagreements are soundness red flags,
// counter disagreements mean the candidate changed solver decisions. The
// baseline file is untracked, so a fresh checkout may not have it; the
// loader below fails with creation instructions instead of a cryptic
// import error.
//
// Usage:
//   BENCH_MARK_AMBIGUOUS=1 npx vitest run src/lib/puzzle/solver-layers-stats.test.js
// Optional environment:
//   BENCH_SEED - seed for a reproducible board sequence (mulberry32 PRNG);
//     also controls pregenerate_layers internals
//   BENCH_MARK_AMBIGUOUS_RUNS - boards per grid (default 200)
//   BENCH_MARK_AMBIGUOUS_CAP_MS - wall-clock cap per single solve
//     (default 60000); capped runs are excluded from the statistics

const env = /** @type {any} */ (globalThis).process?.env || {};
const enabled = !!env.BENCH_MARK_AMBIGUOUS;
const NUM_RUNS = Number(env.BENCH_MARK_AMBIGUOUS_RUNS) || 200;
// wall-clock cap on a single markAmbiguousTiles call, guarding against
// the heavy backtracking tail. Capped runs are recorded with capped: true
// and excluded from the elapsed/ambiguous statistics.
const WALL_CLOCK_CAP_MS = Number(env.BENCH_MARK_AMBIGUOUS_CAP_MS) || 60 * 1000;
const TIMEOUT_ERROR = 'benchmark wall-clock cap reached';
const OUTPUT_DIR = 'generator_stats';
const OUTPUT_FILE = `${OUTPUT_DIR}/layered_mark_ambiguous_20x20_paired.json`;
const LAYERING = 0.6;
// long timeout, a single uncapped search can occasionally take minutes
const TIMEOUT = 2 * 60 * 60 * 1000;

/**
 * Loads the baseline solver snapshot. The snapshot is an untracked scratch
 * file (a verbatim copy of solver-layers-alt.js frozen at the start of the
 * optimization series), so it may be missing on a fresh checkout
 * @returns {Promise<typeof import('./solver-layers-alt').LayeredSolver>}
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
				'solver-layers-alt.js frozen at the start of the optimization series\n' +
				'(see agent-doc/solver-perf-plan.md, "Reference snapshot").\n' +
				'Create it with:\n' +
				'\tcp src/lib/puzzle/solver-layers-alt.js src/lib/puzzle/solver-layers-baseline.js\n' +
				`Original error: ${/** @type {Error} */ (error).message}`
		);
	}
}

/**
 * Search work counters collected by one solver instance, shared across all
 * its clones so totals accumulate over the whole trial tree of one run
 * @typedef {Object} SolverStats
 * @property {Number} iterations - markAmbiguousTiles trial-loop iterations
 * @property {Number} trialClones - solver clones made for guess trials
 * @property {Number} shortTrials - single-picture probes of doShortTrials
 * @property {Number} dirtyProcessings - cells processed by processDirtyCells
 */

/**
 * One markAmbiguousTiles run of one solver on one board
 * @typedef {Object} SolverRunRecord
 * @property {Number} elapsedMs - time-to-abort when capped
 * @property {Boolean} capped - true when the wall-clock cap aborted the search
 * @property {Number} numAmbiguous - -1 when capped (search did not finish)
 * @property {Number} ambiguousAtCap - last ambiguous count reported before the cap hit
 * @property {Boolean} unique
 * @property {Boolean|null} solvable - null when capped (unknown)
 * @property {SolverStats} stats - search work counters (partial when capped)
 */

/**
 * Agreement of the two solvers on one board. Every flag is false when
 * baseline and candidate disagree on that verdict/counter - a soundness red
 * flag for the verdicts, and an expected-to-change signal for the counters
 * when the candidate intentionally alters solver decisions
 * @typedef {Object} AgreementRecord
 * @property {Boolean} unique
 * @property {Boolean} solvable
 * @property {Boolean} numAmbiguous
 * @property {Boolean} counters
 */

/**
 * One board, solved by both solvers
 * @typedef {Object} PairedRunRecord
 * @property {String} grid
 * @property {Number} width
 * @property {Number} height
 * @property {Boolean} wrap
 * @property {Number} layeringAmount
 * @property {Number} branchingAmount
 * @property {Number} avoidObvious
 * @property {Number} subCells
 * @property {Number} pregenerateMs
 * @property {'baseline-first'|'candidate-first'} order - run order, alternating by board index
 * @property {SolverRunRecord} baseline
 * @property {SolverRunRecord} candidate
 * @property {AgreementRecord} agree
 */

/** @type {Array<'iterations'|'trialClones'|'shortTrials'|'dirtyProcessings'>} */
const STAT_KEYS = ['iterations', 'trialClones', 'shortTrials', 'dirtyProcessings'];

/**
 * Distribution summary of a number list
 * @typedef {Object} Distribution
 * @property {Number} n
 * @property {Number} mean
 * @property {Number} p50
 * @property {Number} p90
 * @property {Number} p99
 * @property {Number} min
 * @property {Number} max
 */

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
 * Mean of a number list, 0 when empty
 * @param {Number[]} values
 * @returns {Number}
 */
function mean(values) {
	return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
}

/**
 * Distribution of a number list, zeros when empty
 * @param {Number[]} values
 * @returns {Distribution}
 */
function dist(values) {
	const sorted = [...values].sort((a, b) => a - b);
	return {
		n: sorted.length,
		mean: mean(sorted),
		p50: percentile(sorted, 0.5),
		p90: percentile(sorted, 0.9),
		p99: percentile(sorted, 0.99),
		min: sorted.length ? sorted[0] : 0,
		max: sorted.length ? sorted[sorted.length - 1] : 0
	};
}

/**
 * Aggregated paired statistics of one grid kind
 * @typedef {Object} PairedSummary
 * @property {Number} n - boards total
 * @property {Number} cappedBoards - boards where at least one side capped
 * @property {Number} disagreements - boards with at least one agree.* flag false
 * @property {{elapsedMs: Distribution, cappedCount: Number, uniqueCount: Number, unsolvableCount: Number, stats: Record<String, Distribution>}} baseline
 * @property {{elapsedMs: Distribution, cappedCount: Number, uniqueCount: Number, unsolvableCount: Number, stats: Record<String, Distribution>}} candidate
 * @property {Distribution} elapsedDelta - candidate minus baseline, per completed board
 * @property {Number} improved - boards where candidate is >0.5% faster
 * @property {Number} regressed - boards where candidate is >0.5% slower
 * @property {Number} tied - remaining boards
 * @property {Record<String, {mean: Number, min: Number, max: Number}>} counterDelta - candidate minus baseline
 */

/**
 * Summary statistics of the paired runs of one grid kind
 * @param {PairedRunRecord[]} runs
 * @returns {PairedSummary}
 */
function summarize(runs) {
	const completed = runs.filter((r) => !r.baseline.capped && !r.candidate.capped);
	/**
	 * @param {'baseline'|'candidate'} which
	 */
	const side = (which) => ({
		elapsedMs: dist(completed.map((r) => r[which].elapsedMs)),
		cappedCount: runs.filter((r) => r[which].capped).length,
		uniqueCount: completed.filter((r) => r[which].unique).length,
		unsolvableCount: runs.filter((r) => r[which].solvable === false).length,
		stats: Object.fromEntries(
			STAT_KEYS.map((key) => [key, dist(completed.map((r) => r[which].stats[key]))])
		)
	});
	/** @type {Number[]} */
	const deltas = completed.map((r) => r.candidate.elapsedMs - r.baseline.elapsedMs);
	let improved = 0;
	let regressed = 0;
	let tied = 0;
	for (const r of completed) {
		const d = r.candidate.elapsedMs - r.baseline.elapsedMs;
		if (d < -0.005 * r.baseline.elapsedMs) improved += 1;
		else if (d > 0.005 * r.baseline.elapsedMs) regressed += 1;
		else tied += 1;
	}
	/** @type {Record<String, {mean: Number, min: Number, max: Number}>} */
	const counterDelta = {};
	for (const key of STAT_KEYS) {
		const values = completed.map((r) => r.candidate.stats[key] - r.baseline.stats[key]);
		counterDelta[key] = {
			mean: mean(values),
			min: values.length ? Math.min(...values) : 0,
			max: values.length ? Math.max(...values) : 0
		};
	}
	return {
		n: runs.length,
		cappedBoards: runs.length - completed.length,
		disagreements: runs.filter(
			(r) => !r.agree.unique || !r.agree.solvable || !r.agree.numAmbiguous || !r.agree.counters
		).length,
		baseline: side('baseline'),
		candidate: side('candidate'),
		elapsedDelta: dist(deltas),
		improved,
		regressed,
		tied,
		counterDelta
	};
}

/** @type {PairedRunRecord[]} */
const allRuns = [];
const startedIso = new Date().toISOString();

/**
 * Writes all collected data so far, safe to call after every run
 */
function flush() {
	/** @type {Object.<String, PairedSummary>} */
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
					'Paired markAmbiguousTiles timings on fresh pregenerate_layers boards: ' +
					'20x20 non-wrapping, layering 0.6, branching random in [0, 1], ' +
					'avoidObvious random in [0, 0.5]. Every board is solved back-to-back by ' +
					'baseline = solver-layers-baseline.js (frozen snapshot) and ' +
					'candidate = the current solver-layers-alt.js; run order alternates by ' +
					'board index. ambiguousTilesLimit max(100, 0.1 * total) like the ' +
					`uniqueness loop, wall-clock cap ${WALL_CLOCK_CAP_MS} ms per solve ` +
					'(boards where either side capped are excluded from statistics). ' +
					'agree.* flags are false when the two solvers disagree on that ' +
					'verdict/counter; stats are per-run solver work counters',
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
 * Runs markAmbiguousTiles once on a fresh solver instance
 * @param {typeof import('./solver-layers-alt').LayeredSolver} SolverClass
 * @param {import('$lib/puzzle/generator-layers').LayeredTiles} layers
 * @param {import('$lib/puzzle/grids/abstractgrid').AbstractGrid} grid
 * @returns {SolverRunRecord}
 */
function runSolver(SolverClass, layers, grid) {
	const solver = new SolverClass(layers, grid);
	const progress = /** @type {{value: {ambiguous: Number}|null}} */ ({ value: null });
	/** @type {SolverRunRecord} */
	const record = {
		elapsedMs: 0,
		capped: false,
		numAmbiguous: -1,
		ambiguousAtCap: -1,
		unique: false,
		solvable: null,
		stats: { iterations: 0, trialClones: 0, shortTrials: 0, dirtyProcessings: 0 }
	};
	const start = performance.now();
	// the callback runs once per search iteration, outside the
	// solver's internal try/catch, so a throw aborts the whole search
	solver.progress_callback = (p) => {
		progress.value = p;
		if (performance.now() - start > WALL_CLOCK_CAP_MS) {
			throw new Error(TIMEOUT_ERROR);
		}
	};
	try {
		// mirrors the generator's uniqueness loop: ambiguousLimit =
		// max(100, 0.1 * total)
		const { numAmbiguous, unique, solvable } = solver.markAmbiguousTiles(
			Math.max(100, 0.1 * grid.total)
		);
		record.elapsedMs = performance.now() - start;
		record.numAmbiguous = numAmbiguous;
		record.unique = unique;
		record.solvable = solvable;
	} catch (error) {
		if (/** @type {Error} */ (error).message !== TIMEOUT_ERROR) {
			throw error;
		}
		record.elapsedMs = performance.now() - start;
		record.capped = true;
		record.ambiguousAtCap = progress.value ? progress.value.ambiguous : -1;
	}
	record.stats = { ...solver.stats };
	return record;
}

/**
 * Flags the verdict/counter disagreements between the two runs of one board
 * @param {SolverRunRecord} baseline
 * @param {SolverRunRecord} candidate
 * @returns {AgreementRecord}
 */
function compareRuns(baseline, candidate) {
	/** @type {AgreementRecord} */
	const agree = {
		unique: baseline.unique === candidate.unique,
		solvable: baseline.solvable === candidate.solvable,
		numAmbiguous: baseline.numAmbiguous === candidate.numAmbiguous,
		counters: STAT_KEYS.every((key) => baseline.stats[key] === candidate.stats[key])
	};
	const disagreements = Object.entries(agree)
		.filter(([, ok]) => !ok)
		.map(([key]) => key);
	if (disagreements.length > 0) {
		console.warn(
			`baseline/candidate disagreement on ${disagreements.join(', ')}: ` +
				`unique ${baseline.unique}/${candidate.unique}, solvable ${baseline.solvable}/${candidate.solvable}, ` +
				`numAmbiguous ${baseline.numAmbiguous}/${candidate.numAmbiguous}, ` +
				`counters ${JSON.stringify(baseline.stats)} vs ${JSON.stringify(candidate.stats)}`
		);
	}
	return agree;
}

/**
 * Prints the summary of one grid kind
 * @param {String} kind
 */
function printSummary(kind) {
	const s = summarize(allRuns.filter((r) => r.grid === kind));
	console.log(
		`[${kind}] boards ${s.n}, capped ${s.cappedBoards}, disagreements ${s.disagreements}`
	);
	for (const which of /** @type {const} */ (['baseline', 'candidate'])) {
		console.log(`[${kind}] ${which} elapsedMs: ` + JSON.stringify(s[which].elapsedMs));
		console.log(
			`[${kind}] ${which} unique: ${s[which].uniqueCount}, unsolvable: ${s[which].unsolvableCount}`
		);
	}
	console.log(
		`[${kind}] elapsedMs delta (candidate - baseline): ` + JSON.stringify(s.elapsedDelta)
	);
	console.log(
		`[${kind}] per-board elapsedMs: ${s.improved} improved / ${s.regressed} regressed / ` +
			`${s.tied} tied (±0.5%)`
	);
	for (const key of STAT_KEYS) {
		console.log(`[${kind}] counter delta ${key}: ` + JSON.stringify(s.counterDelta[key]));
	}
	console.log(
		`[${kind}] candidate ms per dirtyProcessing: ` +
			(s.candidate.stats.dirtyProcessings.mean
				? (s.candidate.elapsedMs.mean / s.candidate.stats.dirtyProcessings.mean).toFixed(4)
				: 'n/a')
	);
}

// paired-seed protocol: with BENCH_SEED set, Math.random is replaced by a
// seeded PRNG for the duration of the run so that the board sequence is
// reproducible - this also controls pregenerate_layers internals. Runs must
// stay single-threaded while the PRNG is installed; the original Math.random
// is restored in afterAll
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

describe('Benchmark markAmbiguousTiles on paired layered 20x20 boards', () => {
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
			`Times markAmbiguousTiles on ${NUM_RUNS} paired fresh ${label} 20x20 boards`,
			async () => {
				const BaselineSolver = await loadBaselineSolver();
				const grid = makeGrid();
				// warmup: one throwaway board per solver, so both sides are
				// JIT/GC-hot before anything is recorded
				const warmTiles = pregenerate_layers(grid, LAYERING, 0.5, 0.25);
				runSolver(BaselineSolver, warmTiles, grid);
				runSolver(AltLayeredSolver, warmTiles, grid);
				for (let i = 1; i <= NUM_RUNS; i++) {
					const branchingAmount = Math.random();
					const avoidObvious = Math.random() * 0.5;
					const pregenerateStart = performance.now();
					const layers = pregenerate_layers(grid, LAYERING, branchingAmount, avoidObvious);
					const pregenerateMs = performance.now() - pregenerateStart;
					validateLayers(grid, layers);
					// alternate the run order per board to cancel JIT/GC ordering bias
					const order = i % 2 === 1 ? 'baseline-first' : 'candidate-first';
					let baselineRun;
					let candidateRun;
					if (order === 'baseline-first') {
						baselineRun = runSolver(BaselineSolver, layers, grid);
						candidateRun = runSolver(AltLayeredSolver, layers, grid);
					} else {
						candidateRun = runSolver(AltLayeredSolver, layers, grid);
						baselineRun = runSolver(BaselineSolver, layers, grid);
					}
					const agree = compareRuns(baselineRun, candidateRun);
					/** @type {PairedRunRecord} */
					const record = {
						grid: grid.KIND,
						width: grid.width,
						height: grid.height,
						wrap: grid.wrap,
						layeringAmount: LAYERING,
						branchingAmount,
						avoidObvious,
						subCells: layers.reduce((n, cellLayers) => n + cellLayers.length, 0),
						pregenerateMs,
						order,
						baseline: baselineRun,
						candidate: candidateRun,
						agree
					};
					allRuns.push(record);
					flush();
					if (baselineRun.capped || candidateRun.capped) {
						console.warn(
							`[${grid.KIND}] run ${i}: capped (baseline=${baselineRun.capped}, ` +
								`candidate=${candidateRun.capped})`
						);
					} else if (!baselineRun.solvable || !candidateRun.solvable) {
						console.warn(`[${grid.KIND}] run ${i}: anomaly`, record);
					}
					if (i % 10 === 0) {
						console.log(
							`[${grid.KIND}] run ${i}/${NUM_RUNS}: baseline ` +
								`${(baselineRun.elapsedMs / 1000).toFixed(2)} s, candidate ` +
								`${(candidateRun.elapsedMs / 1000).toFixed(2)} s`
						);
					}
				}
				printSummary(grid.KIND);
			},
			TIMEOUT
		);
	}
});
