// Zombie-path detector for the component registries in solver-layers.js.
// See agent-doc/solver-perf-plan.md and the SoA-registry plan discussion.
//
// When mergeComponents() absorbs a component, the absorbed object is never
// emptied and the directions consumed by the merge keep pointing at it in
// slotComponents. Downstream this can (a) feed dead components into
// getAnsweringComponent identity probes, (b) "resurrect" a dead component
// via resolveComponents' join branch, (c) run mergeComponents a second time
// on the same absorbed object (double-counting totalSubcells, or hitting
// the 'Invalid merge' throw). Whether any of that happens on real boards is
// an empirical question - this script measures it two ways:
//
//   MODE=instr (default) - behavior-neutral instrumentation, counts events:
//     merges              total mergeComponents calls
//     secondMerges        absorbed component was already absorbed before
//     deadSurvivor        survivor component was already absorbed before
//     invalidMergeThrows  merge hit the 'Invalid merge' throw condition
//     zombieProbes        getAnsweringComponent returned a dead component
//     leakedSlotRefs      registry (cell,direction) entries pointing at the
//                         just-absorbed component right after the merge
//     leakedOwnerRefs     subcellComponents entries pointing at it (expected 0)
//   MODE=clean - on top of instrumentation, mergeComponents additionally
//     REPOINTS every registry entry pointing at the absorbed component to
//     the survivor and empties the absorbed (semantics cleanup). If zombie
//     paths never fire, nothing that is ever read changes: every board must
//     produce verdicts and work counters identical to the MODE=instr run.
//     Any divergence = proof the paths fire, board listed.
//
// Boards are replayed with the paired benchmark's exact PRNG protocol and
// MODE=instr results are cross-checked against the paired JSON (a mismatch
// means the instrumentation changed behavior - a bug in this script).
//
// Usage:
//   MODE=instr RUNS=200 npx vite-node scratch/zombie-detector.mjs
//   MODE=clean RUNS=200 npx vite-node scratch/zombie-detector.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { pregenerate_layers } from '../src/lib/puzzle/generator-layers.js';
import { LayeredSolver } from '../src/lib/puzzle/solver-layers.js';
import { SquareGrid } from '../src/lib/puzzle/grids/squaregrid.js';
import { HexaGrid } from '../src/lib/puzzle/grids/hexagrid.js';

const SEED = Number(process.env.BENCH_SEED ?? 20260921);
const RUNS = Number(process.env.RUNS ?? 200);
const LAYERING = 0.6;
const MODE = process.env.MODE ?? 'instr';
const OUT = `/tmp/opencode/prof/zombie-${MODE}.json`;

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

// per-run instrumentation state, threaded through the parent chain like stats
const blankCounts = () => ({
	merges: 0,
	secondMerges: 0,
	deadSurvivor: 0,
	invalidMergeThrows: 0,
	zombieProbes: 0,
	leakedSlotRefs: 0,
	leakedOwnerRefs: 0
});

/**
 * Find (or lazily create at the root) this solver tree's zombie state
 * @param {LayeredSolver} solver
 */
function zState(solver) {
	let s = solver;
	while (s.__z === undefined) {
		if (s.parent) {
			s = s.parent;
			continue;
		}
		s.__z = { dead: new WeakSet(), counts: blankCounts() };
		break;
	}
	solver.__z = s.__z;
	return s.__z;
}

const proto = LayeredSolver.prototype;
const origMerge = proto.mergeComponents;
const origGAC = proto.getAnsweringComponent;

proto.getAnsweringComponent = function (index, direction) {
	const result = origGAC.call(this, index, direction);
	if (result !== undefined && zState(this).dead.has(result)) {
		zState(this).counts.zombieProbes++;
	}
	return result;
};

proto.mergeComponents = function (subcellComponent, slotComponent, subCellId) {
	const z = zState(this);
	const index = subCellId % this.grid.total;
	// 'Invalid merge' throw condition, verbatim from mergeComponents
	const subCellDirections = subcellComponent.subCells.get(subCellId) || 0;
	const slotDirections = slotComponent.slots.get(index) || 0;
	if (
		subCellDirections === 0 ||
		slotDirections === 0 ||
		(slotDirections & subCellDirections) === 0
	) {
		z.counts.invalidMergeThrows++;
	}
	if (z.dead.has(slotComponent)) z.counts.secondMerges++;
	if (z.dead.has(subcellComponent)) z.counts.deadSurvivor++;
	const result = origMerge.call(this, subcellComponent, slotComponent, subCellId);
	z.dead.add(slotComponent);
	z.counts.merges++;
	// references to the just-absorbed component that remain in the registries
	for (const [, inner] of this.slotComponents) {
		for (const [, comp] of inner) {
			if (comp === slotComponent) z.counts.leakedSlotRefs++;
		}
	}
	for (const [, comp] of this.subcellComponents) {
		if (comp === slotComponent) z.counts.leakedOwnerRefs++;
	}
	if (MODE === 'clean') {
		// cleanup semantics: the absorbed component should be dead - repoint
		// everything still referencing it, empty it, drop it from the island
		// queue (otherwise the emptied component would trip the island check)
		for (const [, inner] of this.slotComponents) {
			for (const [d, comp] of inner) {
				if (comp === slotComponent) inner.set(d, subcellComponent);
			}
		}
		for (const [sid, comp] of this.subcellComponents) {
			if (comp === slotComponent) this.subcellComponents.set(sid, subcellComponent);
		}
		slotComponent.slots.clear();
		slotComponent.subCells.clear();
		this.avoidIslandQueue.delete(slotComponent);
	}
	return result;
};

/**
 * One untimed markAmbiguousTiles run on a fresh solver (benchmark protocol)
 * @param {Number[][]} layers
 * @param {import('../src/lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
 */
function runOnce(layers, grid) {
	const solver = new LayeredSolver(layers, grid);
	const result = solver.markAmbiguousTiles(Math.max(100, 0.1 * grid.total));
	return {
		numAmbiguous: result.numAmbiguous,
		unique: result.unique,
		solvable: result.solvable,
		stats: { ...solver.stats },
		z: solver.__z ? solver.__z.counts : blankCounts()
	};
}

/** @type {Array<[String, () => any]>} */
const grids = [
	['square', () => new SquareGrid(20, 20, false)],
	['hexagonal', () => new HexaGrid(20, 20, false)]
];

/** @type {Record<String, any[]>} */
const results = {};
for (const [kind, makeGrid] of grids) {
	const grid = makeGrid();
	pregenerate_layers(grid, LAYERING, 0.5, 0.25); // warmup, like the benchmark
	/** @type {any[]} */
	const runs = [];
	// always replay the full 200-board sequence so the PRNG state of the
	// hexa section matches the benchmark regardless of RUNS
	for (let i = 0; i < 200; i++) {
		const branchingAmount = Math.random();
		const avoidObvious = Math.random() * 0.5;
		const layers = pregenerate_layers(grid, LAYERING, branchingAmount, avoidObvious);
		if (i >= RUNS) continue;
		const run = runOnce(layers, grid);
		run.board = i;
		runs.push(run);
	}
	results[kind] = runs;
}

// validity: instrumentation must not change behavior - MODE=instr results
// must match the paired benchmark's candidate side exactly
if (MODE === 'instr') {
	const paired = JSON.parse(
		readFileSync('generator_stats/layered_mark_ambiguous_20x20_paired.json', 'utf8')
	);
	const mismatches = [];
	for (const [kind] of grids) {
		const records = paired.runs.filter((/** @type {any} */ r) => r.grid === kind);
		results[kind].forEach((run, i) => {
			const c = records[i].candidate;
			const statKeys = ['iterations', 'trialClones', 'shortTrials', 'dirtyProcessings'];
			if (
				run.numAmbiguous !== c.numAmbiguous ||
				run.unique !== c.unique ||
				run.solvable !== c.solvable
			) {
				mismatches.push(`${kind}[${i}] verdict`);
			}
			for (const key of statKeys) {
				if (run.stats[key] !== c.stats[key]) mismatches.push(`${kind}[${i}] ${key}`);
			}
		});
	}
	if (mismatches.length > 0) {
		console.error(`INSTRUMENTATION CHANGED BEHAVIOR: ${mismatches.slice(0, 10).join('; ')}`);
		process.exit(1);
	}
	console.log(
		'validity: all verdicts + counters match the paired JSON (instrumentation is behavior-neutral)'
	);
}

// aggregate
const keys = Object.keys(blankCounts());
const summary = {};
for (const [kind] of grids) {
	const totals = Object.fromEntries(keys.map((k) => [k, 0]));
	const boardsWith = Object.fromEntries(keys.map((k) => [k, []]));
	for (const run of results[kind]) {
		for (const k of keys) {
			totals[k] += run.z[k];
			if (run.z[k] > 0) boardsWith[k].push(run.board);
		}
	}
	summary[kind] = {
		totals,
		boardsWith: Object.fromEntries(Object.entries(boardsWith).map(([k, v]) => [k, v.slice(0, 10)]))
	};
}

if (MODE === 'clean') {
	const instr = JSON.parse(readFileSync('/tmp/opencode/prof/zombie-instr.json', 'utf8')).results;
	/** @type {String[]} */
	const divergences = [];
	for (const [kind] of grids) {
		results[kind].forEach((run, i) => {
			const base = instr[kind][i];
			const statKeys = ['iterations', 'trialClones', 'shortTrials', 'dirtyProcessings'];
			if (
				run.numAmbiguous !== base.numAmbiguous ||
				run.unique !== base.unique ||
				run.solvable !== base.solvable
			) {
				divergences.push(
					`${kind}[${i}] verdict ${run.solvable}/${run.unique}/${run.numAmbiguous} vs ${base.solvable}/${base.unique}/${base.numAmbiguous}`
				);
			}
			for (const key of statKeys) {
				if (run.stats[key] !== base.stats[key]) {
					divergences.push(`${kind}[${i}] ${key} ${run.stats[key]} vs ${base.stats[key]}`);
				}
			}
		});
	}
	if (divergences.length === 0) {
		console.log(
			'DIFFERENTIAL: clean-semantics run is decision-identical to the instrumented run on every board - zombie paths never influenced any decision'
		);
	} else {
		console.log(`DIFFERENTIAL: ${divergences.length} divergences (zombie paths DO fire):`);
		for (const d of divergences.slice(0, 20)) console.log(`  ${d}`);
	}
}

console.log(JSON.stringify(summary, undefined, 1));
writeFileSync(OUT, JSON.stringify({ mode: MODE, seed: SEED, runs: RUNS, results }, undefined, 1));
console.log(`wrote ${OUT}`);
