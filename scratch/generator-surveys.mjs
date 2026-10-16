// Historical one-off generator surveys, retired from the test suite: they
// lived in src/lib/puzzle/generator-stats.test.js as permanently skipped
// vitest cases (and one of them still contained a require('fs') that would
// have crashed had it ever run). None of them assert anything. The survey
// bodies are unchanged, only the wrapper went away; each writes its JSON
// into generator_stats/ like it always did. Most reference data dumps or
// scales (1000+ boards) that only made sense when they were written.
//
// Usage:
//   node scratch/generator-surveys.mjs <name>
//   node scratch/generator-surveys.mjs   # lists the available names
import fs from 'node:fs';
import { Generator } from '../src/lib/puzzle/generator.js';
import { HexaGrid } from '../src/lib/puzzle/grids/hexagrid.js';
import { SquareGrid } from '../src/lib/puzzle/grids/squaregrid.js';
import { Solver } from '../src/lib/puzzle/solver.js';
import { EtratGrid } from '../src/lib/puzzle/grids/etratgrid.js';
import { OctaGrid } from '../src/lib/puzzle/grids/octagrid.js';
import { CubeGrid } from '../src/lib/puzzle/grids/cubegrid.js';

/**
 * Solution-count distribution of generated 20x20 wrap boards
 * (generate with 'whatever', enumerate all solutions)
 */
function solutionsCount() {
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
		fs.writeFileSync(filename, JSON.stringify(results, undefined, '\t'));
	}
}

/**
 * Step counts of hand-made square puzzles from the puzzle-pipes project,
 * read from generator_stats/square_puzzle_pipes/
 */
function puzzlePipesDifficulty() {
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
}

/**
 * Difficulty distribution of 1000 generated 5x5 hexa wraps
 */
function stepsDistribution() {
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
	fs.writeFileSync(filename, JSON.stringify(data, undefined, '\t'));
}

/**
 * Median solve steps per tile across hexa wrap grid sizes
 */
function stepsPerSize() {
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
	fs.writeFileSync(
		'generator_stats/iterations_per_tile.json',
		JSON.stringify(results, undefined, '\t')
	);
}

/**
 * Difficulty sweep over generator parameter combinations on square grids
 */
function generatedDifficulty() {
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
								const tiles = gen.generate(branchingAmount, avoidObvious, avoidStraights, 'unique');
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
}

/**
 * Tile-type distribution of generated hexa boards across sizes
 */
function tileCounts() {
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
}

/**
 * Difficulty effect of avoidObvious on hexagon-shaped 11x11 hexa boards
 */
function avoidObviousEffect() {
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
}

/**
 * Share of generated wrap boards that also solve as non-wrap (unwrappable)
 */
function unwrapShare() {
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
	fs.writeFileSync('generator_stats/unwrap_counts.json', JSON.stringify(results, undefined, '\t'));
}

const surveys = {
	'solutions-count': solutionsCount,
	'puzzle-pipes-difficulty': puzzlePipesDifficulty,
	'steps-distribution': stepsDistribution,
	'steps-per-size': stepsPerSize,
	'generated-difficulty': generatedDifficulty,
	'tile-counts': tileCounts,
	'avoid-obvious': avoidObviousEffect,
	'unwrap-share': unwrapShare
};

const name = process.argv[2];
if (!name || !surveys[name]) {
	console.log(`usage: node scratch/generator-surveys.mjs <${Object.keys(surveys).join('|')}>`);
	process.exit(1);
}
surveys[name]();
