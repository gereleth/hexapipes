import { describe, expect, it } from 'vitest';
import { Generator } from './generator';
import { HexaGrid } from './grids/hexagrid';
import { SquareGrid } from './grids/squaregrid';
import { Solver } from './solver';
import { EtratGrid } from './grids/etratgrid';
import { OctaGrid } from './grids/octagrid';
import { CubeGrid } from './grids/cubegrid';
const fs = require('fs');

describe('Test solutions count', () => {
	it.skip('Checks solutions count in generated 20x20 wraps', () => {
		const results = [];
		for (let grid of [
			new HexaGrid(20, 20, true),
			new SquareGrid(20, 20, true),
			new OctaGrid(14, 14, true),
			new EtratGrid(17, 16, true),
			new CubeGrid(20, 20, true)
		]) {
			const counts = new Map();
			for (let i = 0; i < 10; i++) {
				const gen = new Generator(grid);
				const tiles = gen.generate(0.5, 0.5, 0.5, 'whatever');
				const solver = new Solver(tiles, grid);
				for (let _ of solver.solve(true)) {
				}
				const s = solver.solutions.length;
				counts.set(s, (counts.get(s) || 0) + 1);
			}
			results.push({
				grid: grid.KIND,
				solutionCounts: [...counts.entries()].sort((a, b) => a[0] - b[0])
			});
			const filename = `generator_stats/solution_counts.json`;
			fs.writeFile(filename, JSON.stringify(results, undefined, '\t'), function (err) {
				if (err) {
					console.log(err);
				} else {
					console.log('file saved');
				}
			});
		}
	});
});

describe('Check difficulty', () => {
	it.skip('Check difficulty of square puzzles from puzzle-pipes', () => {
		const results = [];
		const deadends = new Set(new SquareGrid(2, 2, false).DIRECTIONS);
		for (let wrap of [false, true]) {
			for (let size of [5, 7, 10, 15, 20, 25]) {
				const path = `generator_stats/square_puzzle_pipes/${size}x${size}${wrap ? '_wrap' : ''}`;
				for (let file of fs.readdirSync(path)) {
					const data = fs.readFileSync(path + '/' + file, { encoding: 'utf-8' });
					/** @type {{tiles:Number[]}} */
					const instance = JSON.parse(data);
					const grid = new SquareGrid(size, size, wrap);
					const solver = new Solver(instance.tiles, grid);
					let steps = 0;
					for (let _ of solver.solve(true)) {
						steps += 1;
					}
					results.push({
						width: size,
						height: size,
						wrap,
						numDeadends: instance.tiles.reduce((prev, x) => prev + (deadends.has(x) ? 1 : 0), 0),
						numStraights: instance.tiles.reduce((prev, x) => prev + (x == 5 || x == 10 ? 1 : 0), 0),
						steps,
						stepsPerTile: steps / grid.total
					});
				}
			}
		}
		fs.writeFileSync(
			'generator_stats/puzzle-pipes_difficulty.json',
			JSON.stringify(results, undefined, '\t')
		);
	});
});

describe('Test steps distribution', () => {
	it.skip('Checks difficulty distribution in generated 5x5 wraps', () => {
		const grid = new HexaGrid(5, 5, true);
		const counts = new Map();
		const examples = new Map();
		for (let i = 0; i < 1000; i++) {
			const gen = new Generator(grid);
			const tiles = gen.generate();
			const solver = new Solver(tiles, grid);
			let steps = 0;
			for (let _ of solver.solve(true)) {
				steps += 1;
			}
			counts.set(steps, (counts.get(steps) || 0) + 1);
			if (!examples.has(steps)) {
				examples.set(steps, tiles);
			}
		}
		const filename = `generator_stats/${grid.width}x${grid.height}${
			grid.wrap ? 'wrap' : ''
		}_steps.json`;
		const data = {
			steps: [...counts.entries()].sort((a, b) => a[0] - b[0]),
			examples: [...examples.entries()].sort((a, b) => a[0] - b[0])
		};
		fs.writeFile(filename, JSON.stringify(data, undefined, '\t'), function (err) {
			if (err) {
				console.log(err);
			} else {
				console.log('file saved');
			}
		});
	});

	it.skip('Finds median steps per tile for puzzles of different sizes', () => {
		const NUM_TRIALS = 100;
		const results = [];
		for (let width of [3, 4, 5, 6, 7, 8, 9, 10]) {
			for (let height of [3, 4, 5, 6, 7, 8, 9, 10]) {
				let counts = [];
				for (let i = 0; i < NUM_TRIALS; i++) {
					const grid = new HexaGrid(width, height, true);
					const gen = new Generator(grid);
					const tiles = gen.generate();
					const solver = new Solver(tiles, grid);
					let steps = 0;
					for (let _ of solver.solve(true)) {
						steps += 1;
					}
					counts.push(steps);
				}
				counts.sort((a, b) => a - b);
				results.push({
					width,
					height,
					min: counts[0],
					max: counts[counts.length - 1],
					p50: counts[Math.floor(NUM_TRIALS / 2)],
					p25: counts[Math.floor(NUM_TRIALS * 0.25)],
					p75: counts[Math.floor(NUM_TRIALS * 0.75)]
				});
			}
		}
		fs.writeFile(
			'generator_stats/iterations_per_tile.json',
			JSON.stringify(results, undefined, '\t'),
			function (err) {
				if (err) {
					console.log(err);
				} else {
					console.log('file saved');
				}
			}
		);
	});
});

describe('Check difficulty', () => {
	it.skip('Check difficulty of static instances', () => {
		const results = [];
		const deadends = new Set(new HexaGrid(2, 2, false).DIRECTIONS);
		for (let wrap of [false, true]) {
			for (let size of [5, 7, 10, 15, 20, 30, 40]) {
				for (let i = 1; i <= 1000; i++) {
					const path = `static/_instances/hexagonal${
						wrap ? '-wrap' : ''
					}/${size}x${size}/${Math.floor((i - 1) / 100)}/${i}.json`;
					const data = fs.readFileSync(path, { encoding: 'utf-8' });
					/** @type {{tiles:Number[]}} */
					const instance = JSON.parse(data);
					const grid = new HexaGrid(size, size, wrap);
					const solver = new Solver(instance.tiles, grid);
					let steps = 0;
					for (let _ of solver.solve(true)) {
						steps += 1;
					}
					results.push({
						width: size,
						height: size,
						wrap,
						numDeadends: instance.tiles.reduce((prev, x) => prev + (deadends.has(x) ? 1 : 0), 0),
						id: i,
						steps,
						stepsPerTile: steps / grid.total
					});
				}
			}
		}
		fs.writeFileSync(
			'generator_stats/static_difficulty.json',
			JSON.stringify(results, undefined, '\t')
		);
	});

	it.skip('Check difficulty of generated instances', () => {
		const results = [];
		const deadends = new Set(new SquareGrid(2, 2, false).DIRECTIONS);
		for (let branchingAmount of [0, 0.25, 0.5, 0.75, 1]) {
			for (let avoidStraights of [0, 0.25, 0.5, 0.75, 1]) {
				for (let wrap of [false, true]) {
					for (let avoidObvious of wrap ? [0] : [1, 0]) {
						for (let size of [5, 7, 10, 15, 20, 30, 40]) {
							for (let i = 1; i <= 1000; i++) {
								try {
									const grid = new SquareGrid(size, size, wrap);
									const gen = new Generator(grid);
									const tiles = gen.generate(
										branchingAmount,
										avoidObvious,
										avoidStraights,
										'unique'
									);
									const solver = new Solver(tiles, grid);
									let steps = 0;
									for (let _ of solver.solve(true)) {
										steps += 1;
									}
									results.push({
										width: size,
										height: size,
										wrap,
										branchingAmount,
										avoidStraights,
										avoidObvious,
										numDeadends: tiles.reduce((prev, x) => prev + (deadends.has(x) ? 1 : 0), 0),
										numStraights: tiles.reduce((prev, x) => prev + (x == 5 || x == 10 ? 1 : 0), 0),
										id: i,
										steps,
										stepsPerTile: steps / grid.total
									});
								} catch (error) {
									console.log({
										branchingAmount,
										avoidObvious,
										avoidStraights,
										size,
										wrap,
										error
									});
									i -= 1;
								}
							}
						}
					}
				}
			}
		}
		fs.writeFileSync(
			'generator_stats/generated_difficulty_square.json',
			JSON.stringify(results, undefined, '\t')
		);
	});

	it.skip('Check tile distributions of static instances', () => {
		const results = [];
		for (let wrap of [false, true]) {
			for (let size of [5, 7, 10, 15, 20, 30, 40]) {
				/** @type {Map<String,Number>} */
				const counts = new Map();
				for (let i = 1; i <= 1000; i++) {
					const path = `static/_instances/hexagonal${
						wrap ? '-wrap' : ''
					}/${size}x${size}/${Math.floor((i - 1) / 100)}/${i}.json`;
					const data = fs.readFileSync(path, { encoding: 'utf-8' });
					/** @type {{tiles:Number[]}} */
					const instance = JSON.parse(data);
					const grid = new HexaGrid(size, size, wrap);
					const hexagon = grid.polygon_at(0);
					const solver = new Solver(instance.tiles, grid);
					for (let tile of instance.tiles) {
						const tileType = hexagon.tileTypes.get(tile);
						if (tileType === undefined) {
							throw 'unknown tile type ' + tile;
						}
						counts.set(tileType.str, (counts.get(tileType.str) || 0) + 1);
					}
				}
				results.push({
					width: size,
					height: size,
					wrap,
					tileCounts: [...counts.entries()]
				});
			}
		}
		fs.writeFileSync(
			'generator_stats/static_tile_counts.json',
			JSON.stringify(results, undefined, '\t')
		);
	});

	it.skip('Check tile distributions of generated instances', () => {
		const results = [];
		for (let branchingAmount of [0.6]) {
			for (let wrap of [false, true]) {
				for (let size of [5, 7, 10, 15, 20, 30, 40]) {
					/** @type {Map<String,Number>} */
					const counts = new Map();
					for (let i = 1; i <= 1000; i++) {
						const grid = new HexaGrid(size, size, wrap);
						const gen = new Generator(grid);
						const tiles = gen.generate(branchingAmount);
						const hexagon = grid.polygon_at(0);
						for (let tile of tiles) {
							const tileType = hexagon.tileTypes.get(tile);
							if (tileType === undefined) {
								throw 'unknown tile type ' + tile;
							}
							counts.set(tileType.str, (counts.get(tileType.str) || 0) + 1);
						}
					}
					results.push({
						width: size,
						height: size,
						wrap,
						branchingAmount,
						tileCounts: [...counts.entries()]
					});
				}
			}
		}
		fs.writeFileSync(
			'generator_stats/generated_tile_counts.json',
			JSON.stringify(results, undefined, '\t')
		);
	});

	it.skip('Check difficulty effect of avoidObvious', () => {
		const results = [];
		const wrap = false;
		for (let branchingAmount of [0.6]) {
			for (let avoidObvious of [0, 1]) {
				for (let size of [11]) {
					const grid = new HexaGrid(size, size, wrap);
					grid.useShape('hexagon');
					for (let i = 1; i <= 10000; i++) {
						const gen = new Generator(grid);
						const tiles = gen.generate(branchingAmount, avoidObvious);
						const solver = new Solver(tiles, grid);
						let steps = 0;
						for (let _ of solver.solve(true)) {
							steps += 1;
						}
						results.push({
							width: size,
							height: size,
							wrap,
							branchingAmount,
							avoidObvious,
							id: i,
							steps,
							stepsPerTile: steps / grid.total
						});
					}
				}
			}
		}
		fs.writeFileSync(
			'generator_stats/avoidObviousEffect.json',
			JSON.stringify(results, undefined, '\t')
		);
	});

	it.skip('Check unwrap probability in square puzzles', () => {
		const results = [];
		const wrap = true;
		const N = 10000;
		for (let branchingAmount of [0.6]) {
			for (let avoidObvious of [0.5]) {
				for (let size of [4, 5, 7]) {
					let unwrapPuzzles = 0;
					const wrapGrid = new SquareGrid(size, size, true);
					const nowrapGrid = new SquareGrid(size, size, false);
					const gen = new Generator(wrapGrid);
					for (let i = 1; i <= N; i++) {
						const tiles = gen.generate(branchingAmount, avoidObvious, 0.5, 'whatever');
						const solver = new Solver(tiles, nowrapGrid);
						try {
							for (let step of solver.solve(true)) {
							}
							if (solver.solutions.length > 0) {
								unwrapPuzzles += 1;
							}
						} catch {}
					}
					results.push({
						width: size,
						height: size,
						wrap,
						branchingAmount,
						avoidObvious,
						unwrapShare: unwrapPuzzles / N
					});
				}
			}
		}
		fs.writeFileSync(
			'generator_stats/unwrap_counts.json',
			JSON.stringify(results, undefined, '\t')
		);
	});
});
