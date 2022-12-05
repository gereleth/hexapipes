import { bench, describe } from 'vitest';
import { Generator } from './generator';
import { HexaGrid } from './hexagrid';

describe('Generate a hexapipes puzzle', () => {
	const options = { iterations: 100, time: 1000 };

	/**
	 * Return a function that generates a puzzle of the given size
	 * @param {Number} width
	 * @param {Number} height
	 * @param {boolean} wrap
	 * @returns
	 */
	const benchFn = function (width, height, wrap) {
		return () => {
			const grid = new HexaGrid(width, height, wrap);
			const gen = new Generator(grid);
			const tiles = gen.generate();
		};
	};

	bench('5x5', benchFn(5, 5, false), options);
	bench('5x5 wrap', benchFn(5, 5, true), options);

	bench('7x7', benchFn(7, 7, false), options);
	bench('7x7 wrap', benchFn(7, 7, true), options);

	bench('10x10', benchFn(10, 10, false), options);
	bench('10x10 wrap', benchFn(10, 10, true), options);

	bench('15x15', benchFn(15, 15, false), options);
	bench('15x15 wrap', benchFn(15, 15, true), options);

	bench('20x20', benchFn(20, 20, false), options);
	bench('20x20 wrap', benchFn(20, 20, true), options);

	bench('30x30', benchFn(30, 30, false), options);
	bench('30x30 wrap', benchFn(30, 30, true), options);

	bench('40x40', benchFn(40, 40, false), options);
	bench('40x40 wrap', benchFn(40, 40, true), options);
});
