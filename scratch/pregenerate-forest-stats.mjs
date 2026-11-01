// Per-board statistics sweep for the forest generator: generates boards
// across grid kinds and knob settings and records counts (tiles, shared
// tiles, pipe nodes, fully connected pipes and tiles, deadend pipes, share
// events around the coverage point) so generator decisions can be grounded
// in measurements. Results go to generator_stats/ as one CSV line per
// generated board.
//
// Usage:
//   node scratch/pregenerate-forest-stats.mjs            # full sweep, 100 boards/combo
//   node scratch/pregenerate-forest-stats.mjs 2          # smoke run, 2 boards/combo
//
// Writes generator_stats/forest-sharing-sweep-20x20-wrap.csv, one line per
// generated board.
import fs from 'node:fs';
import { pregenerateForest, defaultTreeCount } from '#lib/puzzle/generator/generator-forest.js';
import { createGrid, gridKinds } from '#lib/puzzle/grids/grids.js';
import { popcount } from '#lib/puzzle/grids/bitmasks.js';

const WIDTH = 20;
const HEIGHT = 20;
const WRAP = true;
const BOARDS = Number(process.argv[2]) || 100;
const BRANCHINGS = [0, 0.5, 1];
const SHARINGS = Array.from({ length: 10 }, (_, i) => (i + 1) / 10);
const OUT = 'generator_stats/forest-sharing-sweep-20x20-wrap.csv';

/**
 * Board statistics: tile and pipe counts plus the share event split around
 * the coverage point (the first growth move after which every playable cell
 * holds a pipe - the boundary a stop or correction decision may care
 * about).
 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
 * @param {Number} playable
 * @param {Number[][]} tiles
 * @param {any[]} events
 */
function boardStats(grid, playable, tiles, events) {
	let sharedTiles = 0;
	let pipeNodes = 0;
	let fullPipes = 0;
	let fullTiles = 0;
	let deadendPipes = 0;
	for (let cell = 0; cell < grid.total; cell++) {
		const pipes = tiles[cell];
		if (pipes.length === 0) {
			continue;
		}
		if (pipes.length > 1) {
			sharedTiles++;
		}
		const fullyConnected = grid.polygonAt(cell).fullyConnected;
		let union = 0;
		for (const pipe of pipes) {
			pipeNodes++;
			if (pipe === fullyConnected) {
				fullPipes++;
			}
			if (popcount(pipe) === 1) {
				deadendPipes++;
			}
			union |= pipe;
		}
		if (union === fullyConnected) {
			fullTiles++;
		}
	}
	// growth events end where the merge phase begins (first link/fuse)
	const growthEnd = events.findIndex(
		(e) => e.type === 'fuse' || (e.type === 'move' && e.kind === 'link')
	);
	const growth = growthEnd === -1 ? events : events.slice(0, growthEnd);
	let shares = 0;
	let sharesPostCoverage = 0;
	let coverageAt = -1;
	if (growth.length > 0) {
		const seen = new Set();
		for (let i = 0; i < growth.length; i++) {
			seen.add(growth[i].fromCell);
			seen.add(growth[i].neighbour);
			if (coverageAt === -1 && seen.size >= playable) {
				coverageAt = i;
				break;
			}
		}
		for (let i = 0; i < growth.length; i++) {
			if (growth[i].kind !== 'share') {
				continue;
			}
			shares++;
			if (coverageAt !== -1 && i > coverageAt) {
				sharesPostCoverage++;
			}
		}
	}
	return {
		tiles: playable,
		sharedTiles,
		pipeNodes,
		fullPipes,
		fullTiles,
		deadendPipes,
		shareEvents: shares,
		sharesPostCoverage,
		growthMoves: growth.length
	};
}

const header = [
	'gridKind',
	'width',
	'height',
	'wrap',
	'branching',
	'sharing',
	'trees',
	'tiles',
	'sharedTiles',
	'pipeNodes',
	'fullPipes',
	'fullTiles',
	'deadendPipes',
	'shareEvents',
	'sharesPostCoverage',
	'growthMoves',
	'ms'
].join(',');
const lines = [header];
let failures = 0;
const started = performance.now();
for (const kind of gridKinds) {
	const grid = createGrid(kind, WIDTH, HEIGHT, WRAP);
	const playable = grid.total - grid.emptyCells.size;
	const trees = defaultTreeCount(playable);
	for (const branching of BRANCHINGS) {
		for (const sharing of SHARINGS) {
			const comboStart = performance.now();
			for (let board = 0; board < BOARDS; board++) {
				/** @type {any[]} */
				const events = [];
				const t0 = performance.now();
				try {
					const tiles = pregenerateForest(
						grid,
						{ sharingAmount: sharing, branchingAmount: branching },
						(e) => events.push(e)
					);
					const stats = boardStats(grid, playable, tiles, events);
					lines.push(
						[
							kind,
							WIDTH,
							HEIGHT,
							WRAP,
							branching,
							sharing,
							trees,
							stats.tiles,
							stats.sharedTiles,
							stats.pipeNodes,
							stats.fullPipes,
							stats.fullTiles,
							stats.deadendPipes,
							stats.shareEvents,
							stats.sharesPostCoverage,
							stats.growthMoves,
							(performance.now() - t0).toFixed(1)
						].join(',')
					);
				} catch (error) {
					failures++;
					console.error(`${kind} b=${branching} s=${sharing} board ${board}: ${error.message}`);
				}
			}
			console.log(
				`${kind} b=${branching} s=${sharing}: ${((performance.now() - comboStart) / 1000).toFixed(1)}s`
			);
		}
	}
}
fs.writeFileSync(OUT, lines.join('\n') + '\n');
console.log(
	`\nwrote ${lines.length - 1} boards to ${OUT} (${failures} failures) in ${(
		(performance.now() - started) /
		1000
	).toFixed(0)}s`
);
