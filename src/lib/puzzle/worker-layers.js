import { LayeredGenerator, pregenerate_layers } from '$lib/puzzle/generator-layers';
import { LayeredSolver } from '$lib/puzzle/solver-layers-alt';
import { createGrid } from '$lib/puzzle/grids/grids';

/**
 *
 * @param {import('$lib/puzzle/grids/grids').GridOptions} grid
 * @param {import('$lib/puzzle/generator-layers').GeneratorOptions} options
 */
function generate(grid, options) {
	const { kind, width, height, wrap, tiles } = grid;
	const grid_ = createGrid(kind, width, height, wrap, tiles);
	const gen = new LayeredGenerator(grid_);
	/** @param {import('$lib/puzzle/generator-layers').GeneratorProgress} gen_progress */
	gen.generator_progress_callback = function (gen_progress) {
		postMessage({ msg: 'generator_progress', gen_progress });
	};
	/** @param {import('$lib/puzzle/solver-layers-alt').SolverProgress} progress */
	gen.solver_progress_callback = function (progress) {
		postMessage({ msg: 'solver_progress', progress: progress });
	};
	const { layeringAmount, branchingAmount, avoidObvious, solutionsNumber } = options;
	try {
		const tiles = gen.generate(
			layeringAmount ?? 0.6,
			branchingAmount,
			avoidObvious,
			solutionsNumber
		);
		postMessage({ msg: 'generated', tiles });
	} catch (error) {
		postMessage({ msg: 'error', error });
	}
}

// debug mode: step through the uniqueness loop one iteration at a time
/** @type {import('$lib/puzzle/grids/abstractgrid').AbstractGrid|undefined} */
let debugGrid = undefined;
/** @type {Generator<import('$lib/puzzle/generator-layers').IterationSnapshot, void, void>|undefined} */
let debugIterator = undefined;
/** @type {Number[][]|undefined} */
let debugTiles = undefined;

/**
 *
 * @param {import('$lib/puzzle/grids/grids').GridOptions} grid
 * @param {import('$lib/puzzle/generator-layers').GeneratorOptions} options
 */
function debugStart(grid, options) {
	debugStop();
	const { kind, width, height, wrap, tiles } = grid;
	debugGrid = createGrid(kind, width, height, wrap, tiles);
	const gen = new LayeredGenerator(debugGrid);
	/** @param {import('$lib/puzzle/generator-layers').GeneratorProgress} gen_progress */
	gen.generator_progress_callback = function (gen_progress) {
		postMessage({ msg: 'generator_progress', gen_progress });
	};
	/** @param {import('$lib/puzzle/solver-layers-alt').SolverProgress} progress */
	gen.solver_progress_callback = function (progress) {
		postMessage({ msg: 'solver_progress', progress: progress });
	};
	debugIterator = gen.uniqueIterations(
		options.layeringAmount ?? 0.6,
		options.branchingAmount,
		options.avoidObvious,
		options.maxAmbiguousTiles || 0
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
	const solver = new LayeredSolver(debugTiles, debugGrid);
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
 * Runs one pregeneration and streams its growth events for animation
 * @param {import('$lib/puzzle/grids/grids').GridOptions} grid
 * @param {Object} options
 * @param {Number} [options.layeringAmount]
 * @param {Number} [options.branchingAmount]
 * @param {Number} [options.avoidObvious]
 * @param {(Number[]|null)[]} [options.startLayers]
 * @param {Number} [options.reuseMinCount]
 */
function growthStart(grid, options) {
	const { kind, width, height, wrap, tiles } = grid;
	const grid_ = createGrid(kind, width, height, wrap, tiles);
	/** @param {import('$lib/puzzle/generator-layers').GrowthMove} move */
	const onMove = (move) => postMessage({ msg: 'growth-move', move });
	const grownTiles = pregenerate_layers(
		grid_,
		options.layeringAmount ?? 0.6,
		options.branchingAmount ?? 0.5,
		options.avoidObvious ?? 0,
		options.startLayers || [],
		options.reuseMinCount ?? 3,
		onMove
	);
	postMessage({ msg: 'growth-done', tiles: grownTiles });
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
		growthStart(e.data.grid, e.data.options);
	}
};
