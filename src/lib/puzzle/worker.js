import { Generator } from '$lib/puzzle/generator';
import { Solver } from '$lib/puzzle/solver';
import { createGrid } from '$lib/puzzle/grids/grids';

function generate(grid, options) {
	const { gridKind, width, height, wrap } = grid;
	const grid_ = createGrid(gridKind, width, height, wrap);
	const gen = new Generator(grid_);
	/** @param {import('$lib/puzzle/generator').GeneratorProgress} gen_progress */
	gen.generator_progress_callback = function (gen_progress) {
		postMessage({ msg: 'generator_progress', gen_progress });
	};
	/** @param {import('$lib/puzzle/solver').SolverProgress} progress */
	gen.solver_progress_callback = function (progress) {
		postMessage({ msg: 'solver_progress', progress: progress });
	};
	const { branchingAmount, avoidObvious, avoidStraights, solutionsNumber } = options;
	try {
		const tiles = gen.generate(branchingAmount, avoidObvious, avoidStraights, solutionsNumber);
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
