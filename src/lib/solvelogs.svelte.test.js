import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { _calculateStats, SolvesLog } from '#lib/solvelogs.svelte.js';

describe('Calculate streaks and time stats in daily puzzles', () => {
	it('Two days started, none finished', () => {
		const solves = [
			{ puzzleId: '2023-08-20', elapsedTime: -1 },
			{ puzzleId: '2023-08-19', elapsedTime: -1 }
		];
		const stats = _calculateStats(solves, true);
		expect(stats.streak).toBe(0);
		expect(stats.totalSolved).toBe(0);
		expect(stats.currentTime).toBe(Number.POSITIVE_INFINITY);
		expect(stats.bestTime).toBe(Number.POSITIVE_INFINITY);
		expect(stats.meanOf3).toBe(Number.POSITIVE_INFINITY);
		expect(stats.bestMeanOf3).toBe(Number.POSITIVE_INFINITY);
		expect(stats.averageOf5).toBe(Number.POSITIVE_INFINITY);
		expect(stats.bestAverageOf5).toBe(Number.POSITIVE_INFINITY);
		expect(stats.averageOf12).toBe(Number.POSITIVE_INFINITY);
		expect(stats.bestAverageOf12).toBe(Number.POSITIVE_INFINITY);
	});
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

describe('Calculate streaks and time stats in regular puzzles', () => {
	it('One puzzle just started', () => {
		const solves = [{ puzzleId: -1, elapsedTime: -1 }];
		const stats = _calculateStats(solves, false);
		expect(stats.streak).toBe(0);
		expect(stats.totalSolved).toBe(0);
		expect(stats.currentTime).toBe(Number.POSITIVE_INFINITY);
		expect(stats.bestTime).toBe(Number.POSITIVE_INFINITY);
		expect(stats.meanOf3).toBe(Number.POSITIVE_INFINITY);
		expect(stats.bestMeanOf3).toBe(Number.POSITIVE_INFINITY);
		expect(stats.averageOf5).toBe(Number.POSITIVE_INFINITY);
		expect(stats.bestAverageOf5).toBe(Number.POSITIVE_INFINITY);
		expect(stats.averageOf12).toBe(Number.POSITIVE_INFINITY);
		expect(stats.bestAverageOf12).toBe(Number.POSITIVE_INFINITY);
	});
	it('One puzzle solved', () => {
		const solves = [{ puzzleId: -1, elapsedTime: 1 }];
		const stats = _calculateStats(solves, false);
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
	it('Three in a row solved', () => {
		const solves = [
			{ puzzleId: -1, elapsedTime: 10 },
			{ puzzleId: -1, elapsedTime: 8 },
			{ puzzleId: -1, elapsedTime: 12 }
		];
		const stats = _calculateStats(solves, false);
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
	it('Three not in a row solved', () => {
		const solves = [
			{ puzzleId: -1, elapsedTime: 10 },
			{ puzzleId: -1, elapsedTime: 8 },
			{ puzzleId: -1, elapsedTime: -1 },
			{ puzzleId: -1, elapsedTime: 12 }
		];
		const stats = _calculateStats(solves, false);
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
	it('11 solved and one skipped', () => {
		const solves = [
			{ puzzleId: -1, elapsedTime: 10 },
			{ puzzleId: -1, elapsedTime: 10 },
			{ puzzleId: -1, elapsedTime: 10 },
			{ puzzleId: -1, elapsedTime: -1 },
			{ puzzleId: -1, elapsedTime: 12 },
			{ puzzleId: -1, elapsedTime: 12 },
			{ puzzleId: -1, elapsedTime: 12 },
			{ puzzleId: -1, elapsedTime: 12 },
			{ puzzleId: -1, elapsedTime: 12 },
			{ puzzleId: -1, elapsedTime: 12 },
			{ puzzleId: -1, elapsedTime: 12 },
			{ puzzleId: -1, elapsedTime: 12 }
		];
		const stats = _calculateStats(solves, false);
		expect(stats.streak).toBe(3);
		expect(stats.totalSolved).toBe(11);
		expect(stats.currentTime).toBe(10);
		expect(stats.bestTime).toBe(10);
		expect(stats.meanOf3).toBe(10);
		expect(stats.bestMeanOf3).toBe(10);
		expect(stats.averageOf5).toBe(32 / 3);
		expect(stats.bestAverageOf5).toBe(32 / 3);
		expect(stats.averageOf12).toBe(11.6);
		expect(stats.bestAverageOf12).toBe(11.6);
	});
	it('Large streak before and a small one recently', () => {
		const solves = [
			{ puzzleId: -1, elapsedTime: 10 },
			{ puzzleId: -1, elapsedTime: 8 },
			{ puzzleId: -1, elapsedTime: -1 },
			{ puzzleId: -1, elapsedTime: -1 },
			{ puzzleId: -1, elapsedTime: 12 },
			{ puzzleId: -1, elapsedTime: 12 },
			{ puzzleId: -1, elapsedTime: 12 },
			{ puzzleId: -1, elapsedTime: 12 },
			{ puzzleId: -1, elapsedTime: 12 },
			{ puzzleId: -1, elapsedTime: 12 },
			{ puzzleId: -1, elapsedTime: 12 },
			{ puzzleId: -1, elapsedTime: 12 },
			{ puzzleId: -1, elapsedTime: 12 },
			{ puzzleId: -1, elapsedTime: 12 },
			{ puzzleId: -1, elapsedTime: 12 },
			{ puzzleId: -1, elapsedTime: 12 }
		];
		const stats = _calculateStats(solves, false);
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
			{ puzzleId: -1, elapsedTime: 10 },
			{ puzzleId: -1, elapsedTime: 8 },
			{ puzzleId: -1, elapsedTime: -1 },
			{ puzzleId: -1, elapsedTime: -1 },
			{ puzzleId: -1, elapsedTime: 12 },
			{ puzzleId: -1, elapsedTime: 12 },
			{ puzzleId: -1, elapsedTime: 12 },
			{ puzzleId: -1, elapsedTime: 12 },
			{ puzzleId: -1, elapsedTime: 12 },
			{ puzzleId: -1, elapsedTime: 12 },
			{ puzzleId: -1, elapsedTime: 12 },
			{ puzzleId: -1, elapsedTime: 12 },
			{ puzzleId: -1, elapsedTime: 12 },
			{ puzzleId: -1, elapsedTime: 12 },
			{ puzzleId: -1, elapsedTime: 12 },
			{ puzzleId: -1, elapsedTime: 12 },
			{ puzzleId: -1, elapsedTime: -1 },
			{ puzzleId: -1, elapsedTime: -1 },
			{ puzzleId: -1, elapsedTime: 1 },
			{ puzzleId: -1, elapsedTime: 1 },
			{ puzzleId: -1, elapsedTime: 1 },
			{ puzzleId: -1, elapsedTime: 1 },
			{ puzzleId: -1, elapsedTime: 1 },
			{ puzzleId: -1, elapsedTime: 1 },
			{ puzzleId: -1, elapsedTime: 1 },
			{ puzzleId: -1, elapsedTime: 1 },
			{ puzzleId: -1, elapsedTime: 1 },
			{ puzzleId: -1, elapsedTime: 1 },
			{ puzzleId: -1, elapsedTime: 1 },
			{ puzzleId: -1, elapsedTime: 1 }
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

describe('Check solves log functioning', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it('Creates a solves log', (context) => {
		const cleanup = $effect.root(() => {
			const log = new SolvesLog('/hexagonal/5', false);
			expect(log.solves.length).toBe(0);
		});
		context.onTestFinished(() => cleanup());
	});
	it('Starts a random puzzle solve', (context) => {
		const cleanup = $effect.root(() => {
			const log = new SolvesLog('/hexagonal/5', false);
			const t = new Date().valueOf();
			const s = log.reportStart(-1);
			expect(log.solves.length).toBe(1);
			expect(s.puzzleId).toBe(-1);
			expect(s.elapsedTime).toBe(-1);
			expect(s.pausedAt).toBe(-1);
			expect((s.startedAt - t) / 10000).toBeCloseTo(0);
		});
		context.onTestFinished(() => cleanup());
	});
	it('Pauses a random puzzle solve', (context) => {
		const cleanup = $effect.root(() => {
			const log = new SolvesLog('/hexagonal/5', false);
			log.reportStart(-1);
			const t = new Date().valueOf();
			const s = log.pause(-1);
			expect(log.solves.length).toBe(1);
			expect(s.puzzleId).toBe(-1);
			expect(s.elapsedTime).toBe(-1);
			expect((s.pausedAt - t) / 10000).toBeCloseTo(0);
		});
		context.onTestFinished(() => cleanup());
	});
	it('Restarts a random puzzle solve after pause', (context) => {
		const cleanup = $effect.root(() => {
			const log = new SolvesLog('/hexagonal/5', false);
			log.reportStart(-1);
			log.pause(-1);
			const t = new Date().valueOf();
			const s = log.reportStart(-1);
			expect(log.solves.length).toBe(1);
			expect(s.puzzleId).toBe(-1);
			expect(s.elapsedTime).toBe(-1);
			expect(s.pausedAt).toBe(-1);
			expect((s.startedAt - t) / 10000).toBeCloseTo(0);
		});
		context.onTestFinished(() => cleanup());
	});
	it('Starts a random puzzle solve after finishing one', (context) => {
		const cleanup = $effect.root(() => {
			const log = new SolvesLog('/hexagonal/5', false);
			log.reportStart(-1);
			log.reportFinish(-1);
			const t = new Date().valueOf();
			const s = log.reportStart(-1);
			expect(log.solves.length).toBe(2);
			expect(s.puzzleId).toBe(-1);
			expect(s.elapsedTime).toBe(-1);
			expect(s.pausedAt).toBe(-1);
			expect((s.startedAt - t) / 10000).toBeCloseTo(0);
		});
		context.onTestFinished(() => cleanup());
	});
	it('Restarts a finished non-random puzzle solve', (context) => {
		const cleanup = $effect.root(() => {
			const log = new SolvesLog('/hexagonal/5', false);
			const t0 = new Date().valueOf();
			log.reportStart(1);
			log.reportFinish(1);
			log.reportStart(-1);
			log.reportFinish(-1);
			const t = new Date().valueOf();
			const s = log.reportStart(1);
			expect(log.solves.length).toBe(2);
			expect(s.puzzleId).toBe(1);
			expect(s.elapsedTime / 10000).toBeCloseTo(0);
			expect(s.pausedAt).toBe(-1);
			expect((s.startedAt - t0) / 10000).toBeCloseTo(0);
		});
		context.onTestFinished(() => cleanup());
	});
	it('Restarts a skipped non-random puzzle solve', (context) => {
		const cleanup = $effect.root(() => {
			const log = new SolvesLog('/hexagonal/5', false);
			const t0 = log.reportStart(1).startedAt;
			log.reportStart(-1);
			log.reportFinish(-1);
			const s = log.reportStart(1);
			expect(log.solves.length).toBe(3);
			expect(s.puzzleId).toBe(1);
			expect(s.elapsedTime).toBe(-1);
			expect(s.pausedAt).toBe(-1);
			expect(s.startedAt).toBe(t0);
		});
		context.onTestFinished(() => cleanup());
	});
	it('Reacts to a storage event - loads solves data', (context) => {
		const cleanup = $effect.root(() => {
			const log = new SolvesLog('/hexagonal/5', false);
			window.dispatchEvent(
				new StorageEvent('storage', {
					key: log.name,
					newValue: JSON.stringify([
						{
							startedAt: new Date().valueOf(),
							elapsedTime: -1,
							pausedAt: -1,
							puzzleId: -1
						}
					]),
					oldValue: null, // or previous value if applicable
					//   url: window.location.href,
					storageArea: localStorage
				})
			);
			expect(log.solves.length).toBe(1);
		});
		context.onTestFinished(() => cleanup());
	});
	it('Loads initial solves data from localStorage', (context) => {
		const cleanup = $effect.root(() => {
			localStorage.setItem(
				'/hexagonal/5_solves',
				JSON.stringify([
					{
						startedAt: new Date().valueOf(),
						elapsedTime: -1,
						pausedAt: -1,
						puzzleId: -1
					}
				])
			);
			const log = new SolvesLog('/hexagonal/5', false);
			expect(log.solves.length).toBe(1);
		});
		context.onTestFinished(() => cleanup());
	});
	it('Ignores the second finish of the same non-random puzzle', (context) => {
		const cleanup = $effect.root(() => {
			const log = new SolvesLog('/hexagonal/5', false);
			const t0 = log.reportStart(1).startedAt;
			const s = log.reportFinish(1);
			log.reportStart(-1);
			log.reportStart(1);
			const s1 = log.reportFinish(1);
			expect(log.solves.length).toBe(2);
			expect(s1.puzzleId).toBe(1);
			expect(s1.elapsedTime).toBe(s.elapsedTime);
			expect(s1.pausedAt).toBe(-1);
			expect(s1.startedAt).toBe(t0);
		});
		context.onTestFinished(() => cleanup());
	});
	it('Skips a puzzle', (context) => {
		const cleanup = $effect.root(() => {
			const log = new SolvesLog('/hexagonal/5', false);
			log.reportStart(-1);
			log.reportFinish(-1);
			const s = log.reportStart(-1);
			log.skip();
			const s1 = log.reportStart(-1);
			expect(log.solves.length).toBe(3);
			expect(log.stats.streak).toBe(0);
			expect(s.elapsedTime).toBe(-1);
		});
		context.onTestFinished(() => cleanup());
	});
});
