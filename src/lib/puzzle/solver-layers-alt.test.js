import { describe, expect, it } from 'vitest';
import { HexaGrid } from './grids/hexagrid';
import { SquareGrid } from './grids/squaregrid';
import { LayeredCell, LayeredSolver } from './solver-layers-alt';

describe('Test LayeredCell behaviour', () => {
	const grid = new HexaGrid(3, 3, false);
	const polygon = grid.polygon_at(0);
	it('Starts with correct possible states from initial layers - deadend', () => {
		const cell = new LayeredCell([1], polygon, 0);
		expect(cell.possible.size).toBe(6);
		expect([...cell.possible.keys()]).toEqual(expect.arrayContaining([0, 1, 2, 3, 4, 5]));
	});
	it('Starts with correct possible states from initial layers - straight', () => {
		const cell = new LayeredCell([9], polygon, 0);
		expect(cell.possible.size).toBe(3);
		expect(cell.possible.get(0)).toEqual([9]);
		expect(cell.possible.get(1)).toEqual([36]);
		expect(cell.possible.get(2)).toEqual([18]);
	});
	it('Starts with correct possible states from initial layers - deadend + bend', () => {
		const cell = new LayeredCell([1, 6], polygon, 0);
		expect(cell.possible.size).toBe(6);
		expect(cell.possible.get(0)).toEqual([1, 6]);
		expect(cell.possible.get(1)).toEqual([32, 3]);
		expect(cell.possible.get(2)).toEqual([16, 33]);
		expect(cell.possible.get(3)).toEqual([8, 48]);
		expect(cell.possible.get(4)).toEqual([4, 24]);
		expect(cell.possible.get(5)).toEqual([2, 12]);
	});
	it('Starts with correct possible states from initial layers - two opposite deadends', () => {
		const cell = new LayeredCell([1, 8], polygon, 0);
		expect(cell.possible.size).toBe(3);
		expect(cell.possible.get(0)).toEqual([1, 8]);
		expect(cell.possible.get(1)).toEqual([32, 4]);
		expect(cell.possible.get(2)).toEqual([16, 2]);
	});
	it('Reports own deadends - two deadend layers', () => {
		const cell = new LayeredCell([1, 8], polygon, 0);
		const { addedWalls, addedConnections, addedDeadends } = cell.applyConstraints();
		expect(addedConnections).toEqual(0);
		expect(addedWalls).toEqual(0);
		expect(addedDeadends).toEqual(63);
	});
	it('Reports own deadends - deadend + bend', () => {
		const cell = new LayeredCell([1, 6], polygon, 0);
		const { addedWalls, addedConnections, addedDeadends } = cell.applyConstraints();
		expect(addedConnections).toEqual(0);
		expect(addedWalls).toEqual(0);
		expect(addedDeadends).toEqual(0);
	});
	it('Applies wall constraint', () => {
		const cell = new LayeredCell([1, 6], polygon, 0);
		cell.addWall(1);
		const { addedWalls, addedConnections, addedDeadends } = cell.applyConstraints();
		expect(cell.possible.size).toBe(3);
		expect(cell.possible.get(3)).toEqual([8, 48]);
		expect(cell.possible.get(4)).toEqual([4, 24]);
		expect(cell.possible.get(5)).toEqual([2, 12]);
		expect(addedConnections).toEqual(8);
		expect(addedWalls).toEqual(0);
		expect(addedDeadends).toEqual(2);
	});
	it('Applies connection constraint', () => {
		const cell = new LayeredCell([1, 6], polygon, 0);
		cell.addConnection(1);
		const { addedWalls, addedConnections, addedDeadends } = cell.applyConstraints();
		expect(cell.possible.size).toBe(3);
		expect(cell.possible.get(0)).toEqual([1, 6]);
		expect(cell.possible.get(1)).toEqual([32, 3]);
		expect(cell.possible.get(2)).toEqual([16, 33]);
		expect(addedConnections).toEqual(0);
		expect(addedWalls).toEqual(8);
		expect(addedDeadends).toEqual(16);
	});
	it('Applies neighbour deadend constraint', () => {
		const cell = new LayeredCell([1, 6], polygon, 0);
		cell.addNeighbourDeadend(1, 1);
		const { addedWalls, addedConnections, addedDeadends } = cell.applyConstraints();
		expect(cell.possible.size).toBe(5);
		expect(cell.possible.get(1)).toEqual([32, 3]);
		expect(cell.possible.get(2)).toEqual([16, 33]);
		expect(cell.possible.get(3)).toEqual([8, 48]);
		expect(cell.possible.get(4)).toEqual([4, 24]);
		expect(cell.possible.get(5)).toEqual([2, 12]);
		expect(addedConnections).toEqual(0);
		expect(addedWalls).toEqual(0);
		expect(addedDeadends).toEqual(2);
	});
	it('Applies neighbour deadend constraint - a bend must escape deadend area', () => {
		const cell = new LayeredCell([3], polygon, 0);
		// direction 1 is the only escape route
		polygon.directions.forEach((d) => d === 1 || cell.addNeighbourDeadend(d, 1));
		const { addedWalls, addedConnections, addedDeadends } = cell.applyConstraints();
		expect(cell.possible.size).toBe(2);
		expect(cell.possible.get(0)).toEqual([3]);
		expect(cell.possible.get(1)).toEqual([33]);
		expect(addedConnections).toEqual(1);
		expect(addedWalls).toEqual(4 + 8 + 16);
		expect(addedDeadends).toEqual(1);
		expect(cell.ownDeadendWeights.get(1)).toEqual(2);
	});
	it('Transfers neighbour deadend constraints through itself', () => {
		const cell = new LayeredCell([9], polygon, 0);
		cell.addNeighbourDeadend(1, 1);
		const { addedWalls, addedConnections, addedDeadends } = cell.applyConstraints();
		expect(cell.possible.size).toBe(3);
		expect(addedConnections).toEqual(0);
		expect(addedWalls).toEqual(0);
		expect(addedDeadends).toEqual(8);
		expect(cell.ownDeadendWeights.get(8)).toEqual(2);
	});
});

describe('Test LayeredSolver loop avoidance', () => {
	it('Forbids an orientation where a bend closes a loop', () => {
		const grid = new SquareGrid(3, 3, false);
		const tiles = [[9], [12], [8], [3], [4, 3], [14], [1], [5], [6]];
		const solver = new LayeredSolver(tiles, grid);
		[0, 1, 3].forEach((i) => solver.dirty.add(i));
		[0, 1, 3].forEach((i) => solver.processDirtyCell(i));
		const cell = solver.getCell(4);
		expect(cell.connections).toEqual(6);
		expect(cell.walls).toEqual(0);
		expect(cell.neighbourDeadends).toEqual(0);
		solver.processDirtyCell(4);
		expect(cell.possible.size).toEqual(1);
	});
	it('Puts a wall between one-layered Ts over a U-join', () => {
		const grid = new SquareGrid(4, 3, false);
		const tiles = [[1], [13], [13], [4], [1], [14], [11], [4], [1], [6], [3], [4]];
		const solver = new LayeredSolver(tiles, grid);
		const cell6 = solver.getCell(6);
		[1, 2, 5, 6].forEach((i) => solver.dirty.add(i));
		[1, 2, 5, 6].forEach((i) => solver.processDirtyCell(i));
		expect(cell6.possible.size).toEqual(1);
		expect(cell6.connections).toEqual(11);
		expect(cell6.walls).toEqual(4);
	});
	it('Prunes a bend+deadend orientation paired with a T over a U-join', () => {
		const grid = new SquareGrid(4, 3, false);
		const tiles = [[1], [13], [13], [4], [1], [14], [3, 8], [4], [1], [6], [3], [4]];
		const solver = new LayeredSolver(tiles, grid);
		const cell6 = solver.getCell(6);
		const cell5 = solver.getCell(5);
		[1, 2, 5].forEach((i) => solver.dirty.add(i));
		[1, 2, 5].forEach((i) => solver.processDirtyCell(i));
		solver.processDirtyCell(6);
		expect(cell6.possible.size).toEqual(2);
		expect([...cell6.possible.keys()]).toEqual([0, 2]);
	});
});
