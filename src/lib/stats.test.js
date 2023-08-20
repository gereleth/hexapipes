import { describe, expect, it } from 'vitest';
import { _calculateStats } from './stores.js';

describe('Calculate streaks and time stats in daily puzzles', () => {
	it('One day solved', () => {
		const solves = [{ puzzleId: '2023-08-20', elapsedTime: 1 }];
		const stats = _calculateStats(solves, true);
		expect(stats.streak).toBe(1);
		expect(stats.totalSolved).toBe(1);
		expect(stats.currentTime).toBe(1);
		expect(stats.bestTime).toBe(1);
		expect(stats.meanOf3).toBe(Number.POSITIVE_INFINITY);
		expect(stats.bestMeanOf3).toBe(Number.POSITIVE_INFINITY);
		expect(stats.averageOf5).toBe(Number.POSITIVE_INFINITY);
		expect(stats.bestAverageOf5).toBe(Number.POSITIVE_INFINITY);
		expect(stats.averageOf12).toBe(Number.POSITIVE_INFINITY);
		expect(stats.bestAverageOf12).toBe(Number.POSITIVE_INFINITY);
	});
	it('Three days in a row solved', () => {
		const solves = [
			{ puzzleId: '2023-08-20', elapsedTime: 10 },
			{ puzzleId: '2023-08-19', elapsedTime: 8 },
			{ puzzleId: '2023-08-18', elapsedTime: 12 }
		];
		const stats = _calculateStats(solves, true);
		expect(stats.streak).toBe(3);
		expect(stats.totalSolved).toBe(3);
		expect(stats.currentTime).toBe(10);
		expect(stats.bestTime).toBe(8);
		expect(stats.meanOf3).toBe(10);
		expect(stats.bestMeanOf3).toBe(10);
		expect(stats.averageOf5).toBe(Number.POSITIVE_INFINITY);
		expect(stats.bestAverageOf5).toBe(Number.POSITIVE_INFINITY);
		expect(stats.averageOf12).toBe(Number.POSITIVE_INFINITY);
		expect(stats.bestAverageOf12).toBe(Number.POSITIVE_INFINITY);
	});
	it('Three days not in a row solved', () => {
		const solves = [
			{ puzzleId: '2023-08-20', elapsedTime: 10 },
			{ puzzleId: '2023-08-19', elapsedTime: 8 },
			{ puzzleId: '2023-08-17', elapsedTime: 12 }
		];
		const stats = _calculateStats(solves, true);
		expect(stats.streak).toBe(2);
		expect(stats.totalSolved).toBe(3);
		expect(stats.currentTime).toBe(10);
		expect(stats.bestTime).toBe(8);
		expect(stats.meanOf3).toBe(Number.POSITIVE_INFINITY);
		expect(stats.bestMeanOf3).toBe(Number.POSITIVE_INFINITY);
		expect(stats.averageOf5).toBe(Number.POSITIVE_INFINITY);
		expect(stats.bestAverageOf5).toBe(Number.POSITIVE_INFINITY);
		expect(stats.averageOf12).toBe(Number.POSITIVE_INFINITY);
		expect(stats.bestAverageOf12).toBe(Number.POSITIVE_INFINITY);
	});
	it('Large streak before and a small one recently', () => {
		const solves = [
			{ puzzleId: '2023-08-20', elapsedTime: 10 },
			{ puzzleId: '2023-08-19', elapsedTime: 8 },
			{ puzzleId: '2023-08-16', elapsedTime: 12 },
			{ puzzleId: '2023-08-15', elapsedTime: 12 },
			{ puzzleId: '2023-08-14', elapsedTime: 12 },
			{ puzzleId: '2023-08-13', elapsedTime: 12 },
			{ puzzleId: '2023-08-12', elapsedTime: 12 },
			{ puzzleId: '2023-08-11', elapsedTime: 12 },
			{ puzzleId: '2023-08-10', elapsedTime: 12 },
			{ puzzleId: '2023-08-09', elapsedTime: 12 },
			{ puzzleId: '2023-08-08', elapsedTime: 12 },
			{ puzzleId: '2023-08-07', elapsedTime: 12 },
			{ puzzleId: '2023-08-06', elapsedTime: 12 },
			{ puzzleId: '2023-08-05', elapsedTime: 12 }
		];
		const stats = _calculateStats(solves, true);
		expect(stats.streak).toBe(2);
		expect(stats.totalSolved).toBe(14);
		expect(stats.currentTime).toBe(10);
		expect(stats.bestTime).toBe(8);
		expect(stats.meanOf3).toBe(Number.POSITIVE_INFINITY);
		expect(stats.bestMeanOf3).toBe(12);
		expect(stats.averageOf5).toBe(Number.POSITIVE_INFINITY);
		expect(stats.bestAverageOf5).toBe(12);
		expect(stats.averageOf12).toBe(Number.POSITIVE_INFINITY);
		expect(stats.bestAverageOf12).toBe(12);
	});
	it('Large streak before and a small one recently', () => {
		const solves = [
			{ puzzleId: '2023-08-20', elapsedTime: 10 },
			{ puzzleId: '2023-08-19', elapsedTime: 8 },
			{ puzzleId: '2023-08-16', elapsedTime: 12 },
			{ puzzleId: '2023-08-15', elapsedTime: 12 },
			{ puzzleId: '2023-08-14', elapsedTime: 12 },
			{ puzzleId: '2023-08-13', elapsedTime: 12 },
			{ puzzleId: '2023-08-12', elapsedTime: 12 },
			{ puzzleId: '2023-08-11', elapsedTime: 12 },
			{ puzzleId: '2023-08-10', elapsedTime: 12 },
			{ puzzleId: '2023-08-09', elapsedTime: 12 },
			{ puzzleId: '2023-08-08', elapsedTime: 12 },
			{ puzzleId: '2023-08-07', elapsedTime: 12 },
			{ puzzleId: '2023-08-06', elapsedTime: 12 },
			{ puzzleId: '2023-08-05', elapsedTime: 12 }
		];
		const stats = _calculateStats(solves, true);
		expect(stats.streak).toBe(2);
		expect(stats.totalSolved).toBe(14);
		expect(stats.currentTime).toBe(10);
		expect(stats.bestTime).toBe(8);
		expect(stats.meanOf3).toBe(Number.POSITIVE_INFINITY);
		expect(stats.bestMeanOf3).toBe(12);
		expect(stats.averageOf5).toBe(Number.POSITIVE_INFINITY);
		expect(stats.bestAverageOf5).toBe(12);
		expect(stats.averageOf12).toBe(Number.POSITIVE_INFINITY);
		expect(stats.bestAverageOf12).toBe(12);
	});
	it('Large streak before and a small one recently', () => {
		const solves = [
			{ puzzleId: '2023-08-20', elapsedTime: 10 },
			{ puzzleId: '2023-08-19', elapsedTime: 8 },
			{ puzzleId: '2023-08-16', elapsedTime: 12 },
			{ puzzleId: '2023-08-15', elapsedTime: 12 },
			{ puzzleId: '2023-08-14', elapsedTime: 12 },
			{ puzzleId: '2023-08-13', elapsedTime: 12 },
			{ puzzleId: '2023-08-12', elapsedTime: 12 },
			{ puzzleId: '2023-08-11', elapsedTime: 12 },
			{ puzzleId: '2023-08-10', elapsedTime: 12 },
			{ puzzleId: '2023-08-09', elapsedTime: 12 },
			{ puzzleId: '2023-08-08', elapsedTime: 12 },
			{ puzzleId: '2023-08-07', elapsedTime: 12 },
			{ puzzleId: '2023-08-06', elapsedTime: 12 },
			{ puzzleId: '2023-08-05', elapsedTime: 12 }
		];
		const stats = _calculateStats(solves, true);
		expect(stats.streak).toBe(2);
		expect(stats.totalSolved).toBe(14);
		expect(stats.currentTime).toBe(10);
		expect(stats.bestTime).toBe(8);
		expect(stats.meanOf3).toBe(Number.POSITIVE_INFINITY);
		expect(stats.bestMeanOf3).toBe(12);
		expect(stats.averageOf5).toBe(Number.POSITIVE_INFINITY);
		expect(stats.bestAverageOf5).toBe(12);
		expect(stats.averageOf12).toBe(Number.POSITIVE_INFINITY);
		expect(stats.bestAverageOf12).toBe(12);
	});
	it('Two split streaks of 12 before', () => {
		const solves = [
			{ puzzleId: '2023-08-20', elapsedTime: 10 },
			{ puzzleId: '2023-08-19', elapsedTime: 8 },
			{ puzzleId: '2023-08-16', elapsedTime: 12 },
			{ puzzleId: '2023-08-15', elapsedTime: 12 },
			{ puzzleId: '2023-08-14', elapsedTime: 12 },
			{ puzzleId: '2023-08-13', elapsedTime: 12 },
			{ puzzleId: '2023-08-12', elapsedTime: 12 },
			{ puzzleId: '2023-08-11', elapsedTime: 12 },
			{ puzzleId: '2023-08-10', elapsedTime: 12 },
			{ puzzleId: '2023-08-09', elapsedTime: 12 },
			{ puzzleId: '2023-08-08', elapsedTime: 12 },
			{ puzzleId: '2023-08-07', elapsedTime: 12 },
			{ puzzleId: '2023-08-06', elapsedTime: 12 },
			{ puzzleId: '2023-08-05', elapsedTime: 12 },
			{ puzzleId: '2023-07-16', elapsedTime: 1 },
			{ puzzleId: '2023-07-15', elapsedTime: 1 },
			{ puzzleId: '2023-07-14', elapsedTime: 1 },
			{ puzzleId: '2023-07-13', elapsedTime: 1 },
			{ puzzleId: '2023-07-12', elapsedTime: 1 },
			{ puzzleId: '2023-07-11', elapsedTime: 1 },
			{ puzzleId: '2023-07-10', elapsedTime: 1 },
			{ puzzleId: '2023-07-09', elapsedTime: 1 },
			{ puzzleId: '2023-07-08', elapsedTime: 1 },
			{ puzzleId: '2023-07-07', elapsedTime: 1 },
			{ puzzleId: '2023-07-06', elapsedTime: 1 },
			{ puzzleId: '2023-07-05', elapsedTime: 1 }
		];
		const stats = _calculateStats(solves, true);
		expect(stats.streak).toBe(2);
		expect(stats.totalSolved).toBe(26);
		expect(stats.currentTime).toBe(10);
		expect(stats.bestTime).toBe(1);
		expect(stats.meanOf3).toBe(Number.POSITIVE_INFINITY);
		expect(stats.bestMeanOf3).toBe(1);
		expect(stats.averageOf5).toBe(Number.POSITIVE_INFINITY);
		expect(stats.bestAverageOf5).toBe(1);
		expect(stats.averageOf12).toBe(Number.POSITIVE_INFINITY);
		expect(stats.bestAverageOf12).toBe(1);
	});
});
