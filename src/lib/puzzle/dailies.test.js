import { describe, expect, it } from 'vitest';
import { Generator } from './generator';
import { randomGrid } from './grids/grids';
import { Solver } from './solver';
const fs = require('fs');

function randomEvilPuzzle() {
	const grid = randomGrid();
	const avoidObvious = 0.75 + 0.25 * Math.random();
	const avoidStraights = 0.5 + 0.5 * Math.random();
	const branchingAmount = Math.random();
	let bestSteps = 0;
	let bestTiles;
	const t0 = performance.now();
	let elapsed = 0;
	let iteration = 0;
	while (elapsed < 30000) {
		const gen = new Generator(grid);
		const tiles = gen.generate(branchingAmount, avoidObvious, avoidStraights);
		const solver = new Solver(tiles, grid);
		let steps = 0;
		for (let _ of solver.solve(true)) {
			steps += 1;
		}
		steps = steps / (grid.total - grid.emptyCells.size);
		if (steps > bestSteps) {
			bestSteps = steps;
			bestTiles = tiles;
		}
		elapsed = performance.now() - t0;
		iteration++;
	}
	return { grid, tiles: bestTiles, steps: bestSteps, iteration };
}

function getStartDate() {
	const path = 'static/_instances/daily';
	const years = fs.readdirSync(path).sort();
	const year = years[years.length - 1];
	const months = fs.readdirSync(path + '/' + year).sort();
	const month = months[months.length - 1];
	const days = fs.readdirSync(path + '/' + year + '/' + month).sort();
	const day = days[days.length - 1].slice(0, 2);
	const date = new Date(year + '-' + month + '-' + day);
	return new Date(date.valueOf() + 86400 * 1000);
}

describe('Generate dailies', () => {
	it('Creates random evil puzzles', () => {
		let date = getStartDate();
		for (let i = 0; i < 28; i++) {
			const today = date.toISOString();
			const year = today.slice(0, 4);
			const month = today.slice(5, 7);
			const day = today.slice(8, 10);
			const dirpath = `static/_instances/daily/${year}/${month}`;
			const filepath = `static/_instances/daily/${year}/${month}/${day}.json`;
			date = new Date(date.valueOf() + 86400 * 1000);

			fs.mkdirSync(dirpath, { recursive: true });
			const { grid, tiles, steps, iteration } = randomEvilPuzzle();
			fs.writeFileSync(
				filepath,
				JSON.stringify(
					{
						comment: `Random grid, random settings and the meanest puzzle we could manage in 30 seconds. Difficulty: ${steps.toFixed(
							2
						)}, best of ${iteration} attempts.`,
						grid: grid.KIND,
						width: grid.width,
						height: grid.height,
						wrap: grid.wrap,
						tiles
					},
					undefined,
					'\t'
				)
			);
		}
	});
});
