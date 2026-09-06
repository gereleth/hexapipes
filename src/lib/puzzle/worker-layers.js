import { LayeredGenerator } from '$lib/puzzle/generator-layers';
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
	/** @param {import('$lib/puzzle/solver-layers').SolverProgress} progress */
	gen.solver_progress_callback = function (progress) {
		postMessage({ msg: 'solver_progress', progress: progress });
	};
	const { branchingAmount, avoidObvious, solutionsNumber } = options;
	try {
		const tiles = gen.generate(branchingAmount, avoidObvious, solutionsNumber);
		postMessage({ msg: 'generated', tiles });
	} catch (error) {
		postMessage({ msg: 'error', error });
	}
}

onmessage = (e) => {
	if (e.data.command === 'generate') {
		generate(e.data.grid, e.data.options);
	}
};
