import { writable } from 'svelte/store';

export const puzzleCounts = writable({
	hexagonal: {
		'5x5': 1000,
		'7x7': 1000,
		'10x10': 1000,
		'15x15': 1000,
		'20x20': 1000,
		'30x30': 1000,
		'40x40': 1000
	},
	hexagonalWrap: {
		'5x5': 1000,
		'7x7': 1000,
		'10x10': 1000,
		'15x15': 1000,
		'20x20': 1000,
		'30x30': 1000,
		'40x40': 1000
	}
});

/**
 * @typedef {'rotate_lock'|'rotate_rotate'|'orient_lock'} ControlMode
 */

/**
 * @typedef Settings
 * @property {ControlMode} controlMode
 * @property {Boolean} invertRotationDirection
 * @property {Boolean} showTimer
 * @property {Boolean} disableZoomPan
 */

function createSettings() {
	let defaultSettings = {
		controlMode: 'rotate_lock',
		invertRotationDirection: false,
		showTimer: true,
		disableZoomPan: false
	};

	const { subscribe, set, update } = writable(defaultSettings);

	/**
	 * @param {Settings} settings
	 */
	function saveToLocalStorage(settings) {
		const data = JSON.stringify(settings);
		try {
			window.localStorage.setItem('settings', data);
		} catch (error) {
			console.log('error while saving settings to local storage');
			console.error(error);
		}
	}

	function loadFromLocalStorage() {
		try {
			const data = window.localStorage.getItem('settings');
			if (data === null) {
				set(defaultSettings);
			} else {
				const parsed = JSON.parse(data);
				// I changed possible control mode values,
				// so I need to update settings if an old one appears
				if (parsed.controlMode === 'click_to_rotate') {
					parsed.controlMode = 'rotate_lock';
				} else if (parsed.controlMode === 'click_to_orient') {
					parsed.controlMode = 'orient_lock';
				}
				const validControlModes = new Set(['rotate_lock', 'rotate_rotate', 'orient_lock']);
				if (!validControlModes.has(parsed.controlMode)) {
					parsed.controlMode = 'rotate_lock';
				}
				set(Object.assign({}, defaultSettings, parsed));
			}
		} catch (error) {
			console.log('error while loading settings from local storage');
			console.error(error);
		}
	}

	/**
	 *
	 * @param {Settings} value
	 */
	function set_(value) {
		set(value);
		saveToLocalStorage(value);
	}

	return {
		subscribe,
		loadFromLocalStorage,
		set: set_
	};
}

export const settings = createSettings();

function createSolvesStore(path) {
	// console.log('creating store for', path)
	const name = path + '_solves';

	let data = [];
	const saved = window.localStorage.getItem(name);
	if (saved !== null) {
		data = JSON.parse(saved);
	}

	const { subscribe, set, update } = writable(data);

	subscribe((solves) => {
		// console.log('solves changed:', storeName)
		// console.log(solves)
		const saved = JSON.stringify(solves);
		window.localStorage.setItem(name, saved);
		data = solves;
	});

	window.addEventListener('storage', function (e) {
		// in case something is solved in another tab?
		if (e.key === name) {
			const saved = e.newValue;
			if (saved === null) {
				data = [];
			} else {
				data = JSON.parse(saved);
			}
			set(data);
		}
	});

	function choosePuzzleId(totalCount, currentPuzzleId = 0) {
		// console.log('choose new id for total', totalCount, 'and current id', currentPuzzleId)
		// try to recommend what was unsolved last
		if (data.length > 0 && data[0].elapsedTime === -1 && data[0].puzzleId !== currentPuzzleId) {
			// console.log('returned unsolved id', data[0].puzzleId)
			return data[0].puzzleId;
		}
		// get solved puzzles to exclude them
		const solvedIds = new Set(
			data.filter((solve) => solve.elapsedTime !== -1).map((solve) => solve.puzzleId)
		);
		// console.log('will exclude these ids (solved)', solvedIds)
		let nextPuzzleId = currentPuzzleId;
		if (solvedIds.size < totalCount * 0.7) {
			while (nextPuzzleId === currentPuzzleId || solvedIds.has(nextPuzzleId)) {
				nextPuzzleId = Math.ceil(Math.random() * totalCount);
				// console.log('tried', nextPuzzleId)
			}
			// console.log('chose', nextPuzzleId)
			return nextPuzzleId;
		} else if (solvedIds.size === totalCount) {
			// if everything is solved just give a random puzzle
			while (nextPuzzleId === currentPuzzleId) {
				nextPuzzleId = Math.ceil(Math.random() * totalCount);
			}
			return nextPuzzleId;
		} else {
			const unsolvedIds = [];
			for (let i = 1; i <= totalCount; i++) {
				if (!solvedIds.has(i)) {
					unsolvedIds.push(i);
				}
			}
			return unsolvedIds[Math.floor(Math.random() * unsolvedIds.length)];
		}
	}

	function reportStart(puzzleId) {
		unpause(puzzleId);

		let solve;
		update((solves) => {
			// check if we started this already
			solve = solves.find((solve) => solve.puzzleId === puzzleId);
			if (solve !== undefined) {
				if (solve.elapsedTime !== -1) {
					// finished puzzle
					return solves;
				}
				// started this earlier but did not finish
				if (solve === solves[0]) {
					return solves;
				}
				solve = {
					puzzleId,
					startedAt: solve.startedAt,
					pausedAt: solve.pausedAt,
					elapsedTime: -1
				};
				solves.unshift(solve);
				return solves;
			}
			// If not - then start a fresh solve
			if (solve === undefined) {
				solve = {
					puzzleId,
					startedAt: new Date().valueOf(),
					pausedAt: -1,
					elapsedTime: -1
				};
				solves.unshift(solve);
			}
			return solves;
		});
		return solve;
	}

	function reportFinish(puzzleId) {
		const finishedAt = new Date().valueOf();
		let solve;
		update((solves) => {
			if (solves.length === 0) {
				solve = {
					puzzleId,
					startedAt: -1,
					pausedAt: -1,
					elapsedTime: -1,
					error: 'No started puzzles found, so the finish could not be recorded'
				};
				return solves;
			}
			// find if we solved this already
			solve = solves.find((solve) => solve.puzzleId === puzzleId && solve.elapsedTime !== -1);
			if (solve !== undefined) {
				return solves;
			}
			// check if this puzzle was the last one started
			if (solves[0].puzzleId !== puzzleId) {
				solve = {
					puzzleId,
					startedAt: -1,
					pausedAt: -1,
					elapsedTime: -1,
					error: 'Another puzzle was started after this one, so the finish could not be recorded'
				};
				return solves;
			}
			solve = solves[0];
			// finally record elapsed time
			solve.elapsedTime = finishedAt - solve.startedAt;
			return solves;
		});
		return solve;
	}

	// adds a pausedAt time to a puzzle if the puzzle is running and not paused
	function pause(puzzleId) {
		// console.log('pausing', puzzleId)
		let solve;
		update((solves) => {
			// find if this puzzle is in progress
			solve = solves.find((solve) => solve.puzzleId === puzzleId);
			if (
				solve !== undefined &&
				solve.startedAt !== -1 &&
				solve.elapsedTime === -1 &&
				(solve.pausedAt === -1 || solve.pausedAt === undefined)
			) {
				solve.pausedAt = new Date().valueOf();
				// console.log('paused', puzzleId)
			}
			return solves;
		});
		return solve;
	}

	// removes pausedAt and adjusts startedAt if the puzzle is paused
	function unpause(puzzleId) {
		// console.log('unpausing', puzzleId);
		let solve;
		update((solves) => {
			// find if this puzzle in in progress and paused
			solve = solves.find((solve) => solve.puzzleId === puzzleId);
			// if a puzzle started earlier was saved with no pausedAt property
			if (solve && solve.pausedAt === undefined) {
				solve.pausedAt = -1;
			}
			if (
				solve !== undefined &&
				solve.startedAt !== -1 &&
				solve.elapsedTime === -1 &&
				solve.pausedAt > solve.startedAt
			) {
				const now = new Date().valueOf();
				const pausedElapsedTime = now - solve.pausedAt;
				solve.pausedAt = -1; // clear paused time
				// console.log('unpaused', puzzleId)

				// guard against unexpected quirks like setting clock back
				if (pausedElapsedTime >= 0) {
					// bump startedAt forward by exact amount of time spent paused, so calculated
					// elapsed time picks up where it left off
					solve.startedAt += pausedElapsedTime;
				}
			}
			return solves;
		});
		return solve;
	}

	return {
		subscribe,
		reportStart,
		reportFinish,
		choosePuzzleId,
		pause,
		unpause
	};
}

const solvesStores = new Map();

export function getSolves(path) {
	// path is like /<category>/<size>/<puzzle id>
	// this takes the category and size parts only
	const storeName = path.split('/', 3).join('/');
	if (solvesStores.has(storeName)) {
		return solvesStores.get(storeName);
	} else {
		let store = createSolvesStore(storeName);
		solvesStores.set(storeName, store);
		return store;
	}
}

function createStatsStore(path) {
	// console.log('creating stats store for', path)

	const solvesStore = getSolves(path);
	const isDaily = path === '/daily';

	const data = {
		streak: 0,
		totalSolved: 0,
		single: {
			current: Number.POSITIVE_INFINITY,
			best: Number.POSITIVE_INFINITY,
			previousBest: Number.POSITIVE_INFINITY
		},
		meanOf3: {
			current: Number.POSITIVE_INFINITY,
			best: Number.POSITIVE_INFINITY,
			previousBest: Number.POSITIVE_INFINITY
		},
		averageOf5: {
			current: Number.POSITIVE_INFINITY,
			best: Number.POSITIVE_INFINITY,
			previousBest: Number.POSITIVE_INFINITY
		},
		averageOf12: {
			current: Number.POSITIVE_INFINITY,
			best: Number.POSITIVE_INFINITY,
			previousBest: Number.POSITIVE_INFINITY
		}
	};

	const { subscribe, set, update } = writable(data);

	/**
	 * Calculate mean of array of numbers
	 * @param {Number[]} arr
	 * @returns {Number}
	 */
	function meanOfArray(arr) {
		let mean = 0;
		for (let item of arr) {
			mean += item;
		}
		mean /= arr.length;
		return mean;
	}

	/**
	 * Calculate mean of array of numbers
	 * while excluding one min and one max value
	 * @param {Number[]} arr
	 * @returns {Number}
	 */
	function averageOfArray(arr) {
		const sorted = [...arr].sort((a, b) => a - b);
		let mean = 0;
		for (let item of sorted.slice(1, -1)) {
			mean += item;
		}
		mean /= arr.length - 2;
		return mean;
	}

	function _calculateStats(solves) {
		let streak = 0;
		let totalSolved = 0;
		let streakIncrement = 1;
		const startIndex = solves.length > 0 && solves[0].elapsedTime === -1 ? 1 : 0;
		let currentTime = null;
		let bestTime = Number.POSITIVE_INFINITY;
		let meanOf3 = null;
		let bestMeanOf3 = Number.POSITIVE_INFINITY;
		let ts = [];
		let averageOf5 = null;
		let bestAverageOf5 = Number.POSITIVE_INFINITY;
		let averageOf12 = null;
		let bestAverageOf12 = Number.POSITIVE_INFINITY;
		for (let i = startIndex; i < solves.length; i++) {
			let t = solves[i].elapsedTime;
			let isSolved = t !== -1;
			let isStreak = isSolved;
			let missedDays = 0;
			if (isDaily && isStreak && i !== startIndex) {
				const thisDay = new Date(solves[i].puzzleId);
				const prevDay = new Date(solves[i - 1].puzzleId);
				const daysBetween = Math.round(
					(prevDay.valueOf() - thisDay.valueOf()) / (24 * 60 * 60 * 1000)
				);
				if (daysBetween > 1) {
					isStreak = false;
					missedDays = Math.min(12, daysBetween - 1);
				}
			}
			if (isSolved) {
				totalSolved += 1;
				bestTime = Math.min(bestTime, t);
				if (currentTime === null) {
					currentTime = t;
				}
			} else if (currentTime === null) {
				currentTime = Number.POSITIVE_INFINITY;
			}

			if (isStreak) {
				streak += streakIncrement;
				ts.push(t);
			} else {
				streakIncrement = 0;
				for (let d = 0; d < missedDays; d++) {
					ts.push(Number.POSITIVE_INFINITY);
				}
				ts.push(isSolved ? t : Number.POSITIVE_INFINITY);
			}
			if (ts.length > 12) {
				ts.shift();
			}
			if (ts.length >= 3) {
				if (meanOf3 === null) {
					meanOf3 = meanOfArray(ts.slice(-3));
				}
				bestMeanOf3 = Math.min(meanOfArray(ts.slice(-3)), bestMeanOf3);
			}
			if (ts.length >= 5) {
				if (averageOf5 === null) {
					averageOf5 = averageOfArray(ts.slice(-5));
				}
				bestAverageOf5 = Math.min(averageOfArray(ts.slice(-5)), bestAverageOf5);
			}
			if (ts.length >= 12) {
				if (averageOf12 === null) {
					averageOf12 = averageOfArray(ts);
				}
				bestAverageOf12 = Math.min(averageOfArray(ts), bestAverageOf12);
			}
		}
		if (currentTime === null) {
			currentTime = Number.POSITIVE_INFINITY;
		}
		if (meanOf3 === null) {
			meanOf3 = Number.POSITIVE_INFINITY;
		}
		if (averageOf5 === null) {
			averageOf5 = Number.POSITIVE_INFINITY;
		}
		if (averageOf12 === null) {
			averageOf12 = Number.POSITIVE_INFINITY;
		}
		return {
			streak,
			totalSolved,
			currentTime,
			bestTime,
			meanOf3,
			bestMeanOf3,
			averageOf5,
			bestAverageOf5,
			averageOf12,
			bestAverageOf12
		};
	}

	solvesStore.subscribe((solves) => {
		update((data) => {
			const newStats = _calculateStats(solves);
			data.streak = newStats.streak;
			data.totalSolved = newStats.totalSolved;
			data.single = {
				current: newStats.currentTime,
				best: newStats.bestTime,
				previousBest: data.single.best
			};
			data.meanOf3 = {
				current: newStats.meanOf3,
				best: newStats.bestMeanOf3,
				previousBest: data.meanOf3.best
			};
			data.averageOf5 = {
				current: newStats.averageOf5,
				best: newStats.bestAverageOf5,
				previousBest: data.averageOf5.best
			};
			data.averageOf12 = {
				current: newStats.averageOf12,
				best: newStats.bestAverageOf12,
				previousBest: data.averageOf12.best
			};
			return data;
		});
	});

	return {
		subscribe
	};
}

const statsStores = new Map();

export function getStats(path) {
	const storeName = path.split('/', 3).join('/');
	if (statsStores.has(storeName)) {
		return statsStores.get(storeName);
	} else {
		let store = createStatsStore(storeName);
		statsStores.set(storeName, store);
		return store;
	}
}
