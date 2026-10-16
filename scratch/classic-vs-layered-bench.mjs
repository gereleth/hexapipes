// Paired benchmark: can the LayeredSolver replace the classic Solver inside
// the classic generator's uniqueness loop? Every board comes from one classic
// pregenerate_growingtree call (no uniqueness retries) with the per-grid
// parameter distributions of PuzzleInstanceWrapper.generatePuzzle(), and is
// marked twice back-to-back: by the classic Solver on the raw tiles and by
// the LayeredSolver on the one-layer conversion (every cell becomes a single
// layer with the same direction mask). Boards stay in solved orientation -
// that is what the uniqueness loop feeds its solver, and it is the load that
// matters for generation speed. Because both solves share the same process
// state, the comparison is much less affected by whatever else the machine
// is doing than cross-session wall-clock comparisons. The run order
// alternates per board index to cancel residual JIT/GC ordering bias, and
// one throwaway warmup board per grid gets both solvers hot before anything
// is recorded.
//
// Per board the run compares the two solvers' verdicts (solvable / unique /
// numAmbiguous): the two solvers are different algorithms, so the work
// counters are recorded side by side but never flagged - the verdict flags
// are the soundness signal for the one-layer unification idea.
//
// Usage:
//   node scratch/classic-vs-layered-bench.mjs
// Optional environment:
//   BENCH_SEED - seed for a reproducible board sequence (mulberry32 PRNG),
//     default 20261016; also controls pregenerate_growingtree internals
//   BENCH_MARK_AMBIGUOUS_RUNS - boards per grid (default 100)
//   BENCH_MARK_AMBIGUOUS_CAP_MS - wall-clock cap per single solve
//     (default 60000); capped runs are excluded from the statistics
import { mkdirSync, writeFileSync } from 'node:fs';
import { Generator } from '../src/lib/puzzle/generator.js';
import { Solver } from '../src/lib/puzzle/solver.js';
import { LayeredSolver } from '../src/lib/puzzle/solver-layers.js';
import { createGrid, gridKinds } from '../src/lib/puzzle/grids/grids.js';

const env = process.env;
const NUM_RUNS = Number(env.BENCH_MARK_AMBIGUOUS_RUNS) || 100;
// wall-clock cap on a single markAmbiguousTiles call, guarding against
// the heavy backtracking tail. Capped runs are recorded with capped: true
// and excluded from the elapsed/ambiguous statistics.
const WALL_CLOCK_CAP_MS = Number(env.BENCH_MARK_AMBIGUOUS_CAP_MS) || 60 * 1000;
const TIMEOUT_ERROR = 'benchmark wall-clock cap reached';
const OUTPUT_DIR = 'generator_stats';
// per-grid board size. The three grids where the classic solver's uniqueness
// iteration blows up at 40x40 (etrat 23-71 s, snubsquare 13-27 s,
// triangular 11-12 s per board at 40x40) run at 20x20 to keep the full
// matrix affordable; the fast grids stay at 40x40
const HARD_GRIDS = new Set(['etrat', 'snubsquare', 'triangular']);
/**
 * @param {String} kind
 * @returns {Number}
 */
const gridSize = (kind) => (HARD_GRIDS.has(kind) ? 20 : 40);
const OUTPUT_FILE = `${OUTPUT_DIR}/classic_vs_layered_mark_ambiguous_paired.json`;

/**
 * Search work counters collected by one solver instance, shared across all
 * its clones so totals accumulate over the whole trial tree of one run.
 * Both solvers expose the same four counters; they count the same kinds of
 * steps in two different algorithms, so cross-solver deltas are informative
 * but never a soundness signal
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
 * Verdict agreement of the two solvers on one board. A false flag means the
 * layered solver did not reproduce the classic verdict on an identical
 * one-layer board - the soundness red flag for the unification idea. Flags
 * are null when a side capped (verdicts unknown, not comparable)
 * @typedef {Object} AgreementRecord
 * @property {Boolean|null} unique
 * @property {Boolean|null} solvable
 * @property {Boolean|null} numAmbiguous
 */

/**
 * One board, marked by both solvers
 * @typedef {Object} PairedRunRecord
 * @property {String} grid
 * @property {Number} width
 * @property {Number} height
 * @property {Boolean} wrap
 * @property {Number} totalCells
 * @property {Number} tileCount - non-empty tiles of the generated board
 * @property {Number} branchingAmount
 * @property {Number} avoidObvious
 * @property {Number} avoidStraights
 * @property {Number} pregenerateMs
 * @property {'classic-first'|'layered-first'} order - run order, alternating by board index
 * @property {SolverRunRecord} classic
 * @property {SolverRunRecord} layered
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
 * @property {{elapsedMs: Distribution, cappedCount: Number, uniqueCount: Number, unsolvableCount: Number, stats: Record<String, Distribution>}} classic
 * @property {{elapsedMs: Distribution, cappedCount: Number, uniqueCount: Number, unsolvableCount: Number, stats: Record<String, Distribution>}} layered
 * @property {Distribution} elapsedDelta - layered minus classic, per completed board
 * @property {Number} layeredFaster - boards where layered is >0.5% faster
 * @property {Number} classicFaster - boards where classic is >0.5% faster
 * @property {Number} tied - remaining boards
 * @property {Record<String, {mean: Number, min: Number, max: Number}>} counterDelta - layered minus classic
 */

/**
 * Summary statistics of the paired runs of one grid kind
 * @param {PairedRunRecord[]} runs
 * @returns {PairedSummary}
 */
function summarize(runs) {
	const completed = runs.filter((r) => !r.classic.capped && !r.layered.capped);
	/**
	 * @param {'classic'|'layered'} which
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
	const deltas = completed.map((r) => r.layered.elapsedMs - r.classic.elapsedMs);
	let layeredFaster = 0;
	let classicFaster = 0;
	let tied = 0;
	for (const r of completed) {
		const d = r.layered.elapsedMs - r.classic.elapsedMs;
		if (d < -0.005 * r.classic.elapsedMs) layeredFaster += 1;
		else if (d > 0.005 * r.classic.elapsedMs) classicFaster += 1;
		else tied += 1;
	}
	/** @type {Record<String, {mean: Number, min: Number, max: Number}>} */
	const counterDelta = {};
	for (const key of STAT_KEYS) {
		const values = completed.map((r) => r.layered.stats[key] - r.classic.stats[key]);
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
			(r) =>
				r.agree.unique === false || r.agree.solvable === false || r.agree.numAmbiguous === false
		).length,
		classic: side('classic'),
		layered: side('layered'),
		elapsedDelta: dist(deltas),
		layeredFaster,
		classicFaster,
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
	for (const kind of gridKinds) {
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
					'Paired markAmbiguousTiles timings, classic Solver vs LayeredSolver on the ' +
					'one-layer conversion of the same board. Boards: one classic ' +
					'pregenerate_growingtree call each (no uniqueness retries) with the ' +
					`per-grid parameter distributions of PuzzleInstanceWrapper.generatePuzzle(), ` +
					`solved orientation (no scramble), wrap, one board per ` +
					'grid kind (etrat/snubsquare/triangular at 20x20, the rest at 40x40 - ' +
					'the classic solver is orders of magnitude slower there). ' +
					'ambiguousTilesLimit max(100, 0.1 * total) like the ' +
					`uniqueness loop's first iteration, wall-clock cap ${WALL_CLOCK_CAP_MS} ms ` +
					'per solve (boards where either side capped are excluded from ' +
					'statistics). Run order alternates by board index. agree.* flags are ' +
					'false when the layered solver fails to reproduce the classic verdict; ' +
					'work counters are recorded side by side, never flagged',
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
 * Converts classic tiles to the one-layer layered encoding: every cell
 * becomes a single layer with the same direction mask (0 = empty cell)
 * @param {Number[]} tiles
 * @returns {Number[][]}
 */
function toLayeredTiles(tiles) {
	return tiles.map((tile) => (tile === 0 ? [] : [tile]));
}

/**
 * Draws the pregenerate_growingtree parameters exactly like
 * PuzzleInstanceWrapper.generatePuzzle() does per grid kind: only the
 * square/etrat/cube/rhombitrihexagonal branch consumes randomness, the
 * other kinds use fixed values
 * @param {String} kind
 * @returns {{branchingAmount: Number, avoidObvious: Number, avoidStraights: Number}}
 */
function drawGeneratePuzzleSettings(kind) {
	let branchingAmount = 0.6;
	let avoidObvious = 0;
	let avoidStraights = 0;
	if (kind === 'square' || kind === 'etrat' || kind === 'cube' || kind === 'rhombitrihexagonal') {
		branchingAmount = Math.random() * 0.5 + 0.5; // 0.5 to 1
		avoidObvious = Math.random() * 0.5 + 0.1; // 0.1 to 0.6
		avoidStraights = Math.random() * 0.5 + 0.25; // 0.25 to 0.75
	} else if (kind === 'triangular') {
		branchingAmount = 0;
	}
	return { branchingAmount, avoidObvious, avoidStraights };
}

/**
 * Runs markAmbiguousTiles once on a fresh solver instance
 * @param {typeof Solver|typeof LayeredSolver} SolverClass
 * @param {Number[]|Number[][]} tiles - classic tiles for Solver, one-layer
 * conversion for LayeredSolver
 * @param {import('../src/lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
 * @returns {SolverRunRecord}
 */
function runSolver(SolverClass, tiles, grid) {
	const solver = new SolverClass(tiles, grid);
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
		// mirrors the generator's uniqueness loop first iteration:
		// ambiguousLimit = max(100, 0.1 * total)
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
 * Flags the verdict disagreements between the two runs of one board
 * @param {SolverRunRecord} classic
 * @param {SolverRunRecord} layered
 * @returns {AgreementRecord}
 */
function compareRuns(classic, layered) {
	// a capped side has no verdicts (null/-1 placeholders) - nothing to compare
	const comparable = !classic.capped && !layered.capped;
	/** @type {AgreementRecord} */
	const agree = {
		unique: comparable ? classic.unique === layered.unique : null,
		solvable: comparable ? classic.solvable === layered.solvable : null,
		numAmbiguous: comparable ? classic.numAmbiguous === layered.numAmbiguous : null
	};
	const disagreements = Object.entries(agree)
		.filter(([, ok]) => ok === false)
		.map(([key]) => key);
	if (disagreements.length > 0) {
		console.warn(
			`classic/layered verdict disagreement on ${disagreements.join(', ')}: ` +
				`unique ${classic.unique}/${layered.unique}, solvable ${classic.solvable}/${layered.solvable}, ` +
				`numAmbiguous ${classic.numAmbiguous}/${layered.numAmbiguous}`
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
		`[${kind}] boards ${s.n}, capped ${s.cappedBoards}, verdict disagreements ${s.disagreements}`
	);
	for (const which of /** @type {const} */ (['classic', 'layered'])) {
		console.log(`[${kind}] ${which} elapsedMs: ` + JSON.stringify(s[which].elapsedMs));
		console.log(
			`[${kind}] ${which} unique: ${s[which].uniqueCount}, unsolvable: ${s[which].unsolvableCount}`
		);
	}
	console.log(`[${kind}] elapsedMs delta (layered - classic): ` + JSON.stringify(s.elapsedDelta));
	console.log(
		`[${kind}] per-board elapsedMs: ${s.layeredFaster} layered faster / ` +
			`${s.classicFaster} classic faster / ${s.tied} tied (±0.5%)`
	);
	for (const key of STAT_KEYS) {
		console.log(
			`[${kind}] counter delta ${key} (layered - classic): ` + JSON.stringify(s.counterDelta[key])
		);
	}
	for (const which of /** @type {const} */ (['classic', 'layered'])) {
		console.log(
			`[${kind}] ${which} ms per dirtyProcessing: ` +
				(s[which].stats.dirtyProcessings.mean
					? (s[which].elapsedMs.mean / s[which].stats.dirtyProcessings.mean).toFixed(4)
					: 'n/a')
		);
	}
}

// paired-seed protocol: Math.random is replaced by a seeded PRNG for the
// duration of the run so that the board sequence is reproducible - this also
// controls pregenerate_growingtree internals. Runs must stay single-threaded
// while the PRNG is installed; the original Math.random is restored afterwards
const SEED =
	env.BENCH_SEED !== undefined && env.BENCH_SEED !== '' ? Number(env.BENCH_SEED) : 20261016;

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
		t = Math.imul(t ^ (t >>> 7), 61 | t);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Runs the whole board sequence, all grids sequentially
 */
function runAllGrids() {
	for (const kind of gridKinds) {
		const size = gridSize(kind);
		console.log(`[${kind}] ${NUM_RUNS} paired fresh ${size}x${size} wrap boards`);
		const grid = createGrid(kind, size, size, true);
		const generator = new Generator(grid);
		// warmup: one throwaway board per solver, so both sides are
		// JIT/GC-hot before anything is recorded
		const warmSettings = drawGeneratePuzzleSettings(kind);
		const warmTiles = generator.pregenerate_growingtree(
			warmSettings.branchingAmount,
			warmSettings.avoidObvious,
			warmSettings.avoidStraights
		);
		runSolver(Solver, warmTiles, grid);
		runSolver(LayeredSolver, toLayeredTiles(warmTiles), grid);
		for (let i = 1; i <= NUM_RUNS; i++) {
			const settings = drawGeneratePuzzleSettings(kind);
			const pregenerateStart = performance.now();
			const tiles = generator.pregenerate_growingtree(
				settings.branchingAmount,
				settings.avoidObvious,
				settings.avoidStraights
			);
			const pregenerateMs = performance.now() - pregenerateStart;
			// alternate the run order per board to cancel JIT/GC ordering bias
			const order = i % 2 === 1 ? 'classic-first' : 'layered-first';
			let classicRun;
			let layeredRun;
			if (order === 'classic-first') {
				classicRun = runSolver(Solver, tiles, grid);
				layeredRun = runSolver(LayeredSolver, toLayeredTiles(tiles), grid);
			} else {
				layeredRun = runSolver(LayeredSolver, toLayeredTiles(tiles), grid);
				classicRun = runSolver(Solver, tiles, grid);
			}
			const agree = compareRuns(classicRun, layeredRun);
			/** @type {PairedRunRecord} */
			const record = {
				grid: grid.KIND,
				width: grid.width,
				height: grid.height,
				wrap: grid.wrap,
				totalCells: grid.total,
				tileCount: tiles.filter((t) => t !== 0).length,
				branchingAmount: settings.branchingAmount,
				avoidObvious: settings.avoidObvious,
				avoidStraights: settings.avoidStraights,
				pregenerateMs,
				order,
				classic: classicRun,
				layered: layeredRun,
				agree
			};
			allRuns.push(record);
			flush();
			if (classicRun.capped || layeredRun.capped) {
				console.warn(
					`[${kind}] run ${i}: capped (classic=${classicRun.capped}, ` +
						`layered=${layeredRun.capped})`
				);
			} else if (!classicRun.solvable || !layeredRun.solvable) {
				console.warn(`[${kind}] run ${i}: anomaly`, record);
			}
			if (i % 10 === 0) {
				console.log(
					`[${kind}] run ${i}/${NUM_RUNS}: classic ` +
						`${(classicRun.elapsedMs / 1000).toFixed(2)} s, layered ` +
						`${(layeredRun.elapsedMs / 1000).toFixed(2)} s`
				);
			}
		}
		printSummary(kind);
	}
}

const originalRandom = Math.random;
Math.random = mulberry32(SEED);
try {
	runAllGrids();
} finally {
	Math.random = originalRandom;
}
