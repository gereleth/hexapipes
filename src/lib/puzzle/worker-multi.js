import { MultiGenerator, pregenerateForest } from '#lib/puzzle/generator/generator-forest.js';
import { Solver } from '#lib/puzzle/solver/solver.js';
import { createGrid } from '#lib/puzzle/grids/grids.js';

/**
 *
 * @param {import('#lib/puzzle/grids/grids.js').GridOptions} grid
 * @param {import('#lib/puzzle/generator/generator-forest.js').GeneratorOptions} options
 */
function generate(grid, options) {
	const { kind, width, height, wrap, tiles } = grid;
	const grid_ = createGrid(kind, width, height, wrap, tiles);
	const gen = new MultiGenerator(grid_);
	/** @param {import('#lib/puzzle/generator/generator-forest.js').GeneratorProgress} gen_progress */
	gen.generator_progress_callback = function (gen_progress) {
		postMessage({ msg: 'generator_progress', gen_progress });
	};
	/** @param {import('#lib/puzzle/solver/solver.js').SolverProgress} progress */
	gen.solver_progress_callback = function (progress) {
		postMessage({ msg: 'solver_progress', progress: progress });
	};
	const {
		sharingAmount,
		branchingAmount,
		avoidObvious,
		avoidStraights,
		treeCount,
		solutionsNumber
	} = options;
	try {
		// unset knobs take the engine defaults (sharing 0.35, tree count
		// max(3, floor(playable cells / 20)))
		const tiles = gen.generate(
			sharingAmount,
			branchingAmount,
			avoidObvious,
			solutionsNumber,
			avoidStraights,
			treeCount || 0
		);
		postMessage({ msg: 'generated', tiles });
	} catch (error) {
		postMessage({ msg: 'error', error });
	}
}

// debug mode: step through the uniqueness loop one iteration at a time
/** @type {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid|undefined} */
let debugGrid = undefined;
/** @type {Generator<import('#lib/puzzle/generator/generator-forest.js').IterationSnapshot, void, void>|undefined} */
let debugIterator = undefined;
/** @type {Number[][]|undefined} */
let debugTiles = undefined;

/**
 *
 * @param {import('#lib/puzzle/grids/grids.js').GridOptions} grid
 * @param {import('#lib/puzzle/generator/generator-forest.js').GeneratorOptions} options
 */
function debugStart(grid, options) {
	debugStop();
	const { kind, width, height, wrap, tiles } = grid;
	debugGrid = createGrid(kind, width, height, wrap, tiles);
	const gen = new MultiGenerator(debugGrid);
	/** @param {import('#lib/puzzle/generator/generator-forest.js').GeneratorProgress} gen_progress */
	gen.generator_progress_callback = function (gen_progress) {
		postMessage({ msg: 'generator_progress', gen_progress });
	};
	/** @param {import('#lib/puzzle/solver/solver.js').SolverProgress} progress */
	gen.solver_progress_callback = function (progress) {
		postMessage({ msg: 'solver_progress', progress: progress });
	};
	debugIterator = gen.uniqueIterations(
		options.sharingAmount,
		options.branchingAmount,
		options.avoidObvious,
		options.maxAmbiguousTiles || 0,
		options.avoidStraights,
		options.treeCount || 0
	);
	postMessage({ msg: 'debug-ready' });
}

function debugStep() {
	if (debugIterator === undefined || debugGrid === undefined) {
		postMessage({ msg: 'error', error: 'Send debug-start before debug-step' });
		return;
	}
	const next = debugIterator.next();
	if (next.done) {
		postMessage({ msg: 'debug-done', exhausted: true });
		debugIterator = undefined;
		return;
	}
	const step = next.value;
	debugTiles = step.tiles;
	postMessage({
		msg: 'iteration',
		attempt: step.attempt,
		iteration: step.iteration,
		tiles: step.tiles,
		marked: step.marked,
		numAmbiguous: step.numAmbiguous,
		unique: step.unique,
		keptCount: step.keptCount,
		elapsedMs: step.elapsedMs
	});
	if (step.unique) {
		postMessage({ msg: 'debug-done', exhausted: false });
		debugIterator = undefined;
	}
}

function debugTrueCount() {
	if (debugGrid === undefined || debugTiles === undefined) {
		postMessage({ msg: 'error', error: 'Run at least one debug step first' });
		return;
	}
	const solver = new Solver(debugTiles, debugGrid);
	const started = performance.now();
	const { numAmbiguous } = solver.markAmbiguousTiles();
	postMessage({ msg: 'true-count', numAmbiguous, elapsedMs: performance.now() - started });
}

function debugStop() {
	debugGrid = undefined;
	debugIterator = undefined;
	debugTiles = undefined;
}

/**
 * Runs one forest-engine pass - growth plus merge - and streams its
 * events for animation: several trees grow from spatially balanced seeds
 * until none of them can move; per the sharing knob, tips reaching
 * foreign cells birth new pipes there, braiding trees through each
 * other's territory; the merge phase then links and fuses the trees
 * into one spanning tree. With startTiles the pass regrows instead: the
 * kept reuse components load as some of the trees and the erased region
 * grows around them
 * @param {import('#lib/puzzle/grids/grids.js').GridOptions} grid
 * @param {import('#lib/puzzle/generator/generator-forest.js').ForestKnobs} options
 * @param {import('#lib/puzzle/generator/generator-forest.js').StartTiles} [startTiles] -
 * survivors of a viewed uniqueness iteration, from the debug page
 */
function growthStart(grid, options, startTiles = []) {
	const { kind, width, height, wrap, tiles } = grid;
	const grid_ = createGrid(kind, width, height, wrap, tiles);
	/** @param {import('#lib/puzzle/generator/generator-forest.js').ForestEvent} event */
	const onEvent = (event) => postMessage({ msg: 'growth-move', event });
	try {
		// knob defaults live in the engine, pass the options through as-is
		const grownTiles = pregenerateForest(grid_, options, onEvent, startTiles);
		postMessage({ msg: 'growth-done', tiles: grownTiles });
	} catch (error) {
		postMessage({ msg: 'error', error });
	}
}

onmessage = (e) => {
	if (e.data.command === 'generate') {
		generate(e.data.grid, e.data.options);
	} else if (e.data.command === 'debug-start') {
		debugStart(e.data.grid, e.data.options);
	} else if (e.data.command === 'debug-step') {
		debugStep();
	} else if (e.data.command === 'debug-true-count') {
		debugTrueCount();
	} else if (e.data.command === 'debug-stop') {
		debugStop();
	} else if (e.data.command === 'growth-start') {
		growthStart(e.data.grid, e.data.options, e.data.startTiles);
	}
};
