/**
 * @typedef {Object} Solve
 * @property {Number|String} puzzleId
 * @property {Number} startedAt
 * @property {Number} elapsedTime
 * @property {Number} pausedAt
 * @property {String} [error]
 */

/**
 * @typedef {Object} SolveStats
 * @property {number} streak
 * @property {number} totalSolved
 * @property {number} currentTime
 * @property {number} bestTime
 * @property {number} meanOf3
 * @property {number} bestMeanOf3
 * @property {number} averageOf5
 * @property {number} bestAverageOf5
 * @property {number} averageOf12
 * @property {number} bestAverageOf12
 */

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
 * Calculate statistics from a solves log
 * @param {{puzzleId:number|string, elapsedTime: number}[]} solves
 * @param {Boolean} isDaily
 * @returns {SolveStats}
 */
export function _calculateStats(solves, isDaily) {
	let streak = 0;
	let totalSolved = 0;
	let streakIncrement = 1;
	const startIndex = solves.length > 0 && solves[0].elapsedTime === -1 ? 1 : 0;
	let currentTime = null;
	let bestTime = Number.POSITIVE_INFINITY;
	let meanOf3 = null;
	let bestMeanOf3 = Number.POSITIVE_INFINITY;
	/** @type {Number[]} */
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
			ts.splice(0, ts.length - 12);
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

const defaultStats = {
	streak: 0,
	totalSolved: 0,
	currentTime: Number.POSITIVE_INFINITY,
	bestTime: Number.POSITIVE_INFINITY,
	meanOf3: Number.POSITIVE_INFINITY,
	bestMeanOf3: Number.POSITIVE_INFINITY,
	averageOf5: Number.POSITIVE_INFINITY,
	bestAverageOf5: Number.POSITIVE_INFINITY,
	averageOf12: Number.POSITIVE_INFINITY,
	bestAverageOf12: Number.POSITIVE_INFINITY
};

/**
 * SolvesLog keeps track of solution times for puzzles
 * of a particular grid variant and size.
 */
export class SolvesLog {
	/** @type {string} */
	name;
	/** @type {boolean} */
	isDaily = false;
	/**@type {Solve[]} */
	solves = $state([]);
	/** @type {SolveStats} */
	stats = $derived(_calculateStats(this.solves, this.isDaily));

	/**
	 * @param {string} path
	 * @param {boolean} [isDaily=false] ids are dates for daily puzzles, skipped days count as not solved
	 */
	constructor(path, isDaily = false) {
		this.name = path + '_solves';
		this.isDaily = isDaily;
		const saved = window.localStorage.getItem(this.name);
		if (saved !== null) {
			/** @type {Solve[]} */
			const data = JSON.parse(saved);
			this.solves = data;
		}
		const stats = _calculateStats(this.solves, this.isDaily);
		this.stats = stats;
		this.previousStats = stats;

		// 'this' freaks out in the event listener
		const self = this;
		window.addEventListener('storage', function (e) {
			// in case something is solved in another tab?
			if (e.key === self.name) {
				const saved = e.newValue;
				if (saved === null) {
					self.solves = [];
				} else {
					self.solves = JSON.parse(saved);
				}
			}
		});

		// save solves to local storage whenever they change
		$effect(() => {
			const saved = JSON.stringify(this.solves);
			window.localStorage.setItem(this.name, saved);
		});
	}

	/**
	 * User opens a puzzle
	 * It might be a new one or a continuation of an old one
	 * @param {number|string} puzzleId
	 * @return {Solve}
	 */
	reportStart(puzzleId) {
		// check if we started this already
		let solve = this.solves.find((solve) => solve.puzzleId === puzzleId);
		if (solve === undefined) {
			// No such puzzle was ever started - record a new solve
			solve = {
				puzzleId,
				startedAt: new Date().valueOf(),
				pausedAt: -1,
				elapsedTime: -1
			};
			this.solves.unshift(solve);
		} else if (solve.elapsedTime !== -1) {
			// Solve of this puzzle is finished
			if (puzzleId === -1) {
				// it's a random puzzle - record new solve
				solve = {
					puzzleId,
					startedAt: new Date().valueOf(),
					pausedAt: -1,
					elapsedTime: -1
				};
				this.solves.unshift(solve);
			} else {
				// It's a non-random puzzle (very legacy)
				// Display it as solved and let the user press "New puzzle"
				return solve;
			}
		} else if (solve === this.solves[0]) {
			// This solve was started earlier but not finished, continue with it
			solve = this.unpause(puzzleId);
		} else {
			// Non-random puzzle started earlier and then skipped - record a new solve for it
			solve = {
				puzzleId,
				startedAt: solve.startedAt,
				pausedAt: solve.pausedAt,
				elapsedTime: -1
			};
			this.solves.unshift(solve);
			solve = this.unpause(puzzleId);
		}
		// this.save();
		return solve;
	}

	/**
	 * Remove pausedAt and adjust startedAt if the puzzle is paused
	 * @param {number|string} puzzleId
	 * @returns {Solve}
	 */
	unpause(puzzleId) {
		const solve = this.solves.find((solve) => solve.puzzleId === puzzleId);
		if (solve === undefined) {
			throw Error('Trying to unpause a nonexistent solve');
		}
		// if a puzzle was started before we implemented pausing
		// treat it as unpaused
		if (solve && solve.pausedAt === undefined) {
			solve.pausedAt = -1;
		}
		if (
			solve !== undefined &&
			solve.startedAt !== -1 && // already started
			solve.elapsedTime === -1 && // not yet finished
			solve.pausedAt >= solve.startedAt // has been paused at some point
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
		// this.save();
		return solve;
	}

	/**
	 * Add a pausedAt time to a puzzle if the puzzle is running and not paused
	 * @param {Number|string} puzzleId
	 * @returns {Solve}
	 */
	pause(puzzleId) {
		// console.log('pausing', puzzleId)
		// find if this puzzle is in progress
		const solve = this.solves.find((solve) => solve.puzzleId === puzzleId);
		if (solve === undefined) {
			throw Error('Trying to pause a nonexistent solve');
		}
		if (
			solve.startedAt !== -1 &&
			solve.elapsedTime === -1 &&
			(solve.pausedAt === -1 || solve.pausedAt === undefined)
		) {
			solve.pausedAt = new Date().valueOf();
			// console.log('paused', puzzleId)
		}
		// this.save();
		return solve;
	}

	/**
	 * Complete a puzzle
	 * @param {Number|string} puzzleId
	 * @returns {Solve}
	 */
	reportFinish(puzzleId) {
		const finishedAt = new Date().valueOf();
		// stats change on puzzle finish, so remember previous value
		this.previousStats = $state.snapshot(this.stats);
		if (this.solves.length === 0) {
			const solve = {
				puzzleId,
				startedAt: -1,
				pausedAt: -1,
				elapsedTime: -1,
				error: 'No started puzzles found, so the finish could not be recorded'
			};
			return solve;
		}
		// find if we solved this already
		if (puzzleId !== -1) {
			const solve = this.solves.find(
				(solve) => solve.puzzleId === puzzleId && solve.elapsedTime !== -1
			);
			// do nothing on second solve of the same puzzle, return the first result
			if (solve !== undefined) {
				return solve;
			}
		}
		// check if this puzzle was the last one started
		if (this.solves[0].puzzleId !== puzzleId) {
			const solve = {
				puzzleId,
				startedAt: -1,
				pausedAt: -1,
				elapsedTime: -1,
				error: 'Another puzzle was started after this one, so the finish could not be recorded'
			};
			return solve;
		}
		const solve = this.solves[0];
		// finally record elapsed time
		if (solve.elapsedTime === -1) {
			solve.elapsedTime = finishedAt - solve.startedAt;
		}
		// this.save();
		return solve;
	}

	/**
	 * Indicate that we want to drop a previous random puzzle and start a new one
	 * No puzzleId parameter because this function is only needed for random puzzles
	 */
	skip() {
		this.previousStats = $state.snapshot(this.stats);
		const timestamp = new Date().valueOf();
		const solve = {
			puzzleId: -1,
			startedAt: timestamp,
			pausedAt: timestamp,
			elapsedTime: -1
		};
		this.solves.unshift(solve);
		// this.save();
	}

	/**
	 * Drop the newest solve if it's an unfinished legacy static instance (numeric id > 0)
	 * Those puzzles were retired; the visitor just gets a fresh one
	 * Dropping the solve means we don't interrupt their streak by refusing to provide
	 * that particular instance.
	 */
	popUnfinishedLegacyInstance() {
		const solve = this.solves[0];
		if (
			solve &&
			typeof solve.puzzleId === 'number' &&
			solve.puzzleId > 0 &&
			solve.elapsedTime === -1
		) {
			this.solves.shift();
		}
	}
}

const solvesStores = new Map();

/**
 *
 * @param {String} path
 * @param {boolean} [isDaily=false]
 * @returns {SolvesLog}
 */
export function getSolves(path, isDaily = false) {
	// path is like /<category>/<size>/<puzzle id>
	// this takes the category and size parts only
	const storeName = path.split('/', 3).join('/');
	if (solvesStores.has(storeName)) {
		return solvesStores.get(storeName);
	} else {
		/** @type {SolvesLog | undefined} */
		let store;
		// the log is cached for the whole session and outlives the component
		// that first requested it, so its stats derived and saving effect must
		// not be owned by that component - they would go inert on navigation
		$effect.root(() => {
			store = new SolvesLog(storeName, isDaily);
		});
		solvesStores.set(storeName, store);
		return /** @type {SolvesLog} */ (store);
	}
}
