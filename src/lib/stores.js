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

/**
 * @typedef {Object} Solve
 * @property {Number} puzzleId
 * @property {Number} startedAt
 * @property {Number} elapsedTime
 * @property {Number} pausedAt
 * @property {String|undefined} error
 */

/**
 * @param {String} path
 */
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

	/**
	 * Start a new puzzle or continue a previous one
	 * @param {Number} puzzleId
	 * @returns {Solve}
	 */
	function reportStart(puzzleId) {
		unpause(puzzleId);

		let solve;
		update((solves) => {
			// check if we started this already
			solve = solves.find((/** @type {Solve} */ solve) => solve.puzzleId === puzzleId);
			if (solve !== undefined) {
				if (solve.elapsedTime !== -1) {
					if (puzzleId === -1) {
						// finished random puzzle - start new random puzzle solve
						solve = {
							puzzleId,
							startedAt: new Date().valueOf(),
							pausedAt: -1,
							elapsedTime: -1
						};
						solves.unshift(solve);
						return solves;
					} else {
						// finished non-random puzzle
						return solves;
					}
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
		// @ts-ignore
		return solve;
	}

	/**
	 * Complete a puzzle
	 * @param {Number} puzzleId
	 * @returns {Solve}
	 */
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
			if (puzzleId !== -1) {
				solve = solves.find(
					(/** @type {Solve} */ solve) => solve.puzzleId === puzzleId && solve.elapsedTime !== -1
				);
				if (solve !== undefined) {
					return solves;
				}
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
			if (solve.elapsedTime === -1) {
				solve.elapsedTime = finishedAt - solve.startedAt;
			}
			return solves;
		});
		// @ts-ignore
		return solve;
	}

	/**
	 * Add a pausedAt time to a puzzle if the puzzle is running and not paused
	 * @param {Number} puzzleId
	 * @returns {Solve|undefined}
	 */
	function pause(puzzleId) {
		// console.log('pausing', puzzleId)
		let solve;
		update((solves) => {
			// find if this puzzle is in progress
			solve = solves.find((/** @type {Solve} */ solve) => solve.puzzleId === puzzleId);
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

	/**
	 * Remove pausedAt and adjust startedAt if the puzzle is paused
	 * @param {Number} puzzleId
	 * @returns {Solve|undefined}
	 */
	function unpause(puzzleId) {
		// console.log('unpausing', puzzleId);
		let solve;
		update((solves) => {
			// find if this puzzle in in progress and paused
			solve = solves.find((/** @type {Solve} */ solve) => solve.puzzleId === puzzleId);
			// if a puzzle started earlier was saved with no pausedAt property
			if (solve && solve.pausedAt === undefined) {
				solve.pausedAt = -1;
			}
			if (
				solve !== undefined &&
				solve.startedAt !== -1 &&
				solve.elapsedTime === -1 &&
				solve.pausedAt >= solve.startedAt
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

	/**
	 * Indicate that we want to drop a previous random puzzle and start a new one
	 * No puzzleId parameter because it's only needed for random puzzles
	 */
	function skip() {
		const timestamp = new Date().valueOf();
		const solve = {
			puzzleId: -1,
			startedAt: timestamp,
			pausedAt: timestamp,
			elapsedTime: -1
		};
		update((solves) => {
			solves.unshift(solve);
			return solves;
		});
	}

	return {
		subscribe,
		reportStart,
		reportFinish,
		pause,
		unpause,
		skip
	};
}

/**
 * @typedef {ReturnType<createSolvesStore>} SolvesStore
 */

const solvesStores = new Map();

/**
 *
 * @param {String} path
 * @returns {ReturnType<createSolvesStore>}
 */
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

/**
 * @param {String} path
 */
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

	/**
	 *
	 * @param {Solve[]} solves
	 * @returns
	 */
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

/**
 * @typedef {ReturnType<createStatsStore>} StatsStore
 */

/**
 *
 * @param {String} path
 * @returns {StatsStore}
 */
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
