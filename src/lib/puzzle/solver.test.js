import { describe, expect, it } from 'vitest';
import { HexaGrid } from './hexagrid';
import { Cell, Solver } from './solver';

describe('Test hexagrid cell constraints', () => {
	const grid = new HexaGrid(3, 3, false);

	it('Starts with correct possible states from initial orientation - deadend', () => {
		const index = 0;
		const initial = 1;
		let cell = new Cell(grid, index, initial);
		expect(cell.possible.size).toBe(6);
		expect([...cell.possible]).toEqual(expect.arrayContaining([1, 2, 4, 8, 16, 32]));
	});

	it('Starts with correct possible states from initial orientation - sharp turn', () => {
		const index = 0;
		const initial = 3;
		let cell = new Cell(grid, index, initial);
		expect(cell.possible.size).toBe(6);
		expect([...cell.possible]).toEqual(expect.arrayContaining([3, 6, 12, 24, 48, 33]));
	});

	it('Starts with correct possible states from initial orientation - straight', () => {
		const index = 0;
		const initial = 9;
		let cell = new Cell(grid, index, initial);
		expect(cell.possible.size).toBe(3);
		expect([...cell.possible]).toEqual(expect.arrayContaining([9, 18, 36]));
	});

	it('Drops configurations that contradict walls - deadend', () => {
		const index = 0;
		const initial = 1;
		let cell = new Cell(grid, index, initial);
		cell.addWall(8);
		cell.applyConstraints();
		expect(cell.possible.size).toBe(5);
		expect([...cell.possible]).toEqual(expect.arrayContaining([1, 2, 4, 16, 32]));
	});

	it('Drops configurations that contradict walls - straight', () => {
		const index = 0;
		const initial = 9;
		let cell = new Cell(grid, index, initial);
		cell.addWall(2);
		cell.applyConstraints();
		expect(cell.possible.size).toBe(2);
		expect([...cell.possible]).toEqual(expect.arrayContaining([9, 36]));
	});

	it('Drops configurations that contradict walls - sharp turn', () => {
		const index = 0;
		const initial = 3;
		let cell = new Cell(grid, index, initial);
		cell.addWall(2);
		cell.applyConstraints();
		expect(cell.possible.size).toBe(4);
		expect([...cell.possible]).toEqual(expect.arrayContaining([12, 24, 48, 33]));
	});

	it('Drops configurations that contradict connections - deadend', () => {
		const index = 0;
		const initial = 1;
		let cell = new Cell(grid, index, initial);
		cell.addConnection(8);
		cell.applyConstraints();
		expect(cell.possible.size).toBe(1);
		expect([...cell.possible]).toEqual(expect.arrayContaining([8]));
	});

	it('Drops configurations that contradict connections - straight', () => {
		const index = 0;
		const initial = 9;
		let cell = new Cell(grid, index, initial);
		cell.addConnection(2);
		cell.applyConstraints();
		expect(cell.possible.size).toBe(1);
		expect([...cell.possible]).toEqual(expect.arrayContaining([18]));
	});

	it('Drops configurations that contradict connections - sharp turn', () => {
		const index = 0;
		const initial = 3;
		let cell = new Cell(grid, index, initial);
		cell.addConnection(2);
		cell.applyConstraints();
		expect(cell.possible.size).toBe(2);
		expect([...cell.possible]).toEqual(expect.arrayContaining([3, 6]));
	});

	it('Reports correct added features - deadend', () => {
		const index = 0;
		const initial = 1;
		let cell = new Cell(grid, index, initial);
		cell.addConnection(2);
		const { addedConnections, addedWalls } = cell.applyConstraints();
		expect(addedConnections).toBe(0);
		expect(addedWalls).toBe(61);
	});

	it('Reports correct added features - straight', () => {
		const index = 0;
		const initial = 9;
		let cell = new Cell(grid, index, initial);
		cell.addConnection(2);
		const { addedConnections, addedWalls } = cell.applyConstraints();
		expect(addedConnections).toBe(16);
		expect(addedWalls).toBe(45);
	});

	it('Reports correct added features - wide turn', () => {
		const index = 0;
		const initial = 5;
		let cell = new Cell(grid, index, initial);
		cell.addConnection(2);
		const { addedConnections, addedWalls } = cell.applyConstraints();
		expect(addedConnections).toBe(0);
		expect(addedWalls).toBe(21);
	});

	it('Reports correct added features - X', () => {
		const index = 0;
		const initial = 54;
		let cell = new Cell(grid, index, initial);
		cell.addWall(1);
		const { addedConnections, addedWalls } = cell.applyConstraints();
		expect(addedConnections).toBe(54);
		expect(addedWalls).toBe(8);
	});

	it('Throws error if no orientations are possible - X', () => {
		const index = 0;
		const initial = 54;
		let cell = new Cell(grid, index, initial);
		cell.addWall(3);
		expect(cell.applyConstraints).toThrowError('No orientations possible');
	});
});


describe('Test solver border constraints', () => {
	const grid = new HexaGrid(3, 1, false);
	const tiles = [1, 9, 1]

	it('Starts with correct possible states', () => {
		const solver = new Solver(tiles, grid)
		expect([...solver.unsolved.keys()]).toEqual(expect.arrayContaining([0,1,2]))
		let cell = solver.unsolved.get(0)
		expect(cell?.possible.size).toBe(6);
		expect([...cell.possible]).toEqual(expect.arrayContaining([1, 2, 4, 8, 16, 32]));
		cell = solver.unsolved.get(1)
		expect(cell?.possible.size).toBe(3);
		expect([...cell.possible]).toEqual(expect.arrayContaining([9, 18, 36]));
		cell = solver.unsolved.get(2)
		expect(cell?.possible.size).toBe(6);
		expect([...cell.possible]).toEqual(expect.arrayContaining([1, 2, 4, 8, 16, 32]));
	});

	it('Adds walls to border cells', () => {
		const solver = new Solver(tiles, grid)
		solver.applyBorderConditions()
		let cell = solver.unsolved.get(0)
		expect(cell?.walls).toBe(62);
		cell = solver.unsolved.get(1)
		expect(cell?.walls).toBe(54);
		cell = solver.unsolved.get(2)
		expect(cell?.walls).toBe(55);
		expect([...solver.dirty]).toEqual(expect.arrayContaining([0, 1, 2]));
	});

	it('Adds full and empty cells to dirty set', () => {
		const solver = new Solver([
			1, 1, 1, 1,
			1, 0, 63, 1,
			1, 1, 1, 1], new HexaGrid(4, 3, false))
		solver.applyBorderConditions()
		let cell = solver.unsolved.get(5)
		expect(cell?.walls).toBe(0);
		cell = solver.unsolved.get(6)
		expect(cell?.connections).toBe(0);
		expect([...solver.dirty]).toContain(5);
		expect([...solver.dirty]).toContain(6);
	});

	it('Does not add constraints to cells in a wrap puzzle', () => {
		let grid = new HexaGrid(3, 1, true)
		const solver = new Solver(tiles, grid)
		solver.applyBorderConditions()
		expect(solver.dirty.size).toBe(0);
	});
});