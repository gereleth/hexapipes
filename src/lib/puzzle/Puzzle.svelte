<script>
	import { innerWidth, innerHeight } from 'svelte/reactivity/window';
	import { settings } from '$lib/stores';
	import { controls } from '$lib/puzzle/controls';
	import Tile from '$lib/puzzle/Tile.svelte';
	import { onMount, onDestroy } from 'svelte';
	import { PipesGame } from '$lib/puzzle/game.svelte.js';
	import { Solver } from './solver';
	import EdgeMarks from './EdgeMarks.svelte';

	/**
	 * @typedef {Object} Props
	 * @property {import('$lib/puzzle/grids/abstractgrid').AbstractGrid} grid
	 * @property {Number[]} [tiles]
	 * @property {import('$lib/puzzle/game.svelte').Progress|undefined} [savedProgress]
	 * @property {string} [progressStoreName]
	 * @property {Number|undefined} [preferredPxPerCell]
	 * @property {boolean} [showSolveButton]
	 * @property {boolean} [animate]
	 * @property {()=>void} [started]
	 * @property {()=>void} finished
	 * @property {(x:{name:string, data:any})=>void} [progress]
	 * @property {()=>void} [paused]
	 */

	/** @type {Props} */
	let {
		grid,
		tiles = [],
		savedProgress = undefined,
		progressStoreName = '',
		preferredPxPerCell = undefined,
		showSolveButton = false,
		animate = $bindable(false),
		started = () => {},
		finished,
		progress = () => {},
		paused = () => {}
	} = $props();

	// Remember the name that the puzzle was created with
	// to prevent accidental saving to another puzzle's progress
	// if a user navigates between puzzles directly via back/forward buttons
	const myProgressName = progressStoreName;

	let svgWidth = $state(500);
	let svgHeight = $state(500);

	const game = new PipesGame(grid, tiles, savedProgress);

	const pxPerCell = 60;

	const viewBox = game.viewBox;
	$viewBox.width = Math.min(grid.XMAX - grid.XMIN, 500 / pxPerCell);
	$viewBox.height = Math.min(grid.YMAX - grid.YMIN, 500 / pxPerCell);
	const visibleTiles = viewBox.visibleTiles;

	export const startOver = function () {
		game.startOver();
	};

	export const reportPxPerCell = function () {
		return svgWidth / $viewBox.width;
	};

	/**
	 * @returns {void}
	 */
	function initialResize() {
		const iw = innerWidth.current || 500;
		const ih = innerHeight.current || 500;
		// take full width without scroll bar
		const maxPixelWidth = iw - 18;
		// take most height, leave some for scrolling the page on mobile
		const maxPixelHeight = $settings.disableZoomPan ? ih : Math.round(0.8 * ih);

		const maxGridWidth = grid.XMAX - grid.XMIN;
		const maxGridHeight = grid.YMAX - grid.YMIN;

		const wpx = maxPixelWidth / maxGridWidth;
		const hpx = maxPixelHeight / maxGridHeight;
		let pxPerCell = Math.min(100, wpx, hpx);
		if (!$settings.disableZoomPan) {
			pxPerCell = Math.max(60, pxPerCell);
		}
		if (grid.wrap || $settings.disableZoomPan) {
			svgWidth = Math.min(maxPixelWidth, pxPerCell * maxGridWidth);
		} else {
			svgWidth = maxPixelWidth;
		}
		svgHeight = Math.min(maxPixelHeight, pxPerCell * maxGridHeight);
		if (preferredPxPerCell) {
			pxPerCell = preferredPxPerCell;
		}
		$viewBox.width = svgWidth / pxPerCell;
		$viewBox.height = svgHeight / pxPerCell;
		// center grid if the puzzle fully fits inside bounds
		if ($viewBox.width > maxGridWidth) {
			$viewBox.xmin = (grid.XMAX + grid.XMIN - $viewBox.width) * 0.5;
		}
		if ($viewBox.height > maxGridHeight) {
			$viewBox.ymin = (grid.YMAX + grid.YMIN - $viewBox.height) * 0.5;
		}
	}

	function resize() {
		if ($settings.disableZoomPan) {
			// do nothing to let browser zoom handle it all
			return;
		}
		const iw = innerWidth.current || 500;
		const ih = innerHeight.current || 500;
		const pxPerCell = svgWidth / $viewBox.width;
		// take full width without scroll bar
		const maxPixelWidth = iw - 18;
		// take most height, leave some for scrolling the page on mobile
		const maxPixelHeight = Math.round(0.8 * ih);
		if (grid.wrap) {
			svgWidth = Math.min(
				maxPixelWidth,
				pxPerCell * Math.max($viewBox.width, grid.XMAX - grid.XMIN)
			);
		} else {
			svgWidth = maxPixelWidth;
		}
		svgHeight = Math.min(maxPixelHeight, pxPerCell * $viewBox.height);
		$viewBox.width = svgWidth / pxPerCell;
		$viewBox.height = svgHeight / pxPerCell;
		// center grid if the puzzle fully fits inside bounds
		if ($viewBox.width > grid.XMAX - grid.XMIN) {
			$viewBox.xmin = (grid.XMAX + grid.XMIN - $viewBox.width) * 0.5;
		}
		if ($viewBox.height > grid.YMAX - grid.YMIN) {
			$viewBox.ymin = (grid.YMAX + grid.YMIN - $viewBox.height) * 0.5;
		}
	}

	onMount(() => {
		game.initializeBoard();
		initialResize();
		started();
		// unleashTheSolver();
	});

	onDestroy(() => {
		// save progress immediately if navigating away (?)
		save.clear();
		if (!game.solved) {
			save.now();
			paused();
		}
	});

	/**
	 *
	 * @param {()=>void} callback
	 * @param {number} timeout ms
	 */
	function createThrottle(callback, timeout) {
		/** @type {number|null}*/
		let throttleTimer = null;
		const throttle = (callback, timeout) => {
			if (throttleTimer !== null) return;
			throttleTimer = setTimeout(() => {
				callback();
				throttleTimer = null;
			}, timeout);
		};
		const clear = () => {
			if (throttleTimer !== null) {
				clearTimeout(throttleTimer);
				throttleTimer = null;
			}
		};
		return {
			now: () => callback(),
			soon: () => throttle(callback, timeout),
			clear
		};
	}

	function saveProgress() {
		if (game.solved) {
			return;
		}
		const tileStates = game.tileStates.map((data) => {
			return {
				rotations: data.rotations,
				locked: data.locked,
				color: data.color,
				edgeMarks: data.edgeMarks
			};
		});
		progress({
			name: myProgressName,
			data: {
				tiles: tileStates
			}
		});
	}

	/**
	 * @param {Number} ms
	 */
	function sleep(ms) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
	/**
	 * @type {import('$lib/puzzle/solver').Solver|undefined}
	 */
	let solver;
	/**
	 * @type {number[][]}
	 */
	let solutions = $state([]);
	export async function unleashTheSolver() {
		measureSolveTime();
		if (!game.solved) {
			// unlock all tiles
			for (let tileState of game.tileStates) {
				tileState.locked = false;
			}
			solver = new Solver(tiles, grid);
			try {
				for (let { stage, step } of solver.solve(true)) {
					if (stage === 'aftercheck') {
						continue;
					}
					game.toggleLocked(step.index, false);
					const shouldLock = step.final && stage === 'initial';
					game.setTileOrientation(step.index, step.orientation, !shouldLock);
					if (shouldLock) {
						game.toggleLocked(step.index, true);
					}
					if (animate) {
						await sleep(100);
					}
				}
				if (solver.solutions.length > 1) {
					// unlock tiles that are different between solutions
					// and lock those that are the same
					game.solved = false;
					for (let [i, tile] of solver.solutions[0].entries()) {
						const isSame = solver.solutions.every((solution) => solution[i] === tile);
						if (game.tileStates[i].locked !== isSame) {
							game.tileStates[i].toggleLocked();
						}
					}
				}
				solutions = solver.solutions;
			} catch (error) {
				console.error(error);
			}
		}
	}

	let steps = $state(-1);
	let ms = $state(-1);
	/** @type {Number[]}*/
	let msStats = $state([]);
	function measureSolveTime() {
		const t0 = performance.now();
		const solver = new Solver(tiles, grid);
		steps = 0;
		try {
			for (let _ of solver.solve(true)) {
				steps += 1;
			}
		} catch (error) {
			console.log('unsolvable puzzle');
		}
		const t1 = performance.now();
		ms = t1 - t0;
		msStats.push(ms);
		msStats = msStats.sort((a, b) => a - b);
		solutions = solver.solutions;
	}

	const save = createThrottle(saveProgress, 3000);

	export const download = function () {
		const data = {
			grid: grid.KIND,
			width: grid.width,
			height: grid.height,
			wrap: grid.wrap,
			tiles
		};
		const dataString = JSON.stringify(data, null, '\t');
		let element = document.createElement('a');
		const href = 'data:text/json;charset=utf-8,' + encodeURIComponent(dataString);
		element.setAttribute('href', href);
		const filename = `${data.width}x${data.height}-${data.grid}${
			data.wrap ? '-wrap' : ''
		}-puzzle.json`;
		element.setAttribute('download', filename);
		element.style.display = 'none';
		document.body.appendChild(element);
		element.click();
		document.body.removeChild(element);
	};

	$effect(() => {
		if (game.solved) {
			finished();
		}
	});

	/**
	 * @param {Event} event
	 */
	function preventDefault(event) {
		event.preventDefault();
	}
</script>

<svelte:window onresize={resize} />

{#if showSolveButton}
	<div class="solve-button">
		<button onclick={unleashTheSolver}>🧩 Solve it</button>
		<label for="animate">
			<input type="checkbox" bind:checked={animate} id="animate" />
			Animate
		</label>
	</div>
	<div class="solve-button">
		{#if ms > -1}
			<div>
				Solved in {steps} steps, {Math.round(10 * msStats[Math.floor(msStats.length / 2)]) / 10} ms (median
				of {msStats.length}
				runs from {Math.round(10 * msStats[0]) / 10} to {Math.round(
					10 * msStats[msStats.length - 1]
				) / 10} ms).
			</div>
			<div>Number of solutions: {solutions.length}</div>
			{#if solutions.length > 1}
				<div>
					{#each solutions as solution, i}
						<button
							onclick={() => {
								solution.forEach((orientation, index) => {
									game.setTileOrientation(index, orientation);
									game.solved = false;
								});
								game.solved = false;
							}}
							>Solution {i + 1}
						</button>
					{/each}
				</div>
			{/if}
		{/if}
	</div>
{/if}

<div class="puzzle animation-{$settings.animationSpeed}" class:solved={game.solved}>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<svg
		width={svgWidth}
		height={svgHeight}
		viewBox="{$viewBox.xmin} {$viewBox.ymin} {$viewBox.width} {$viewBox.height}"
		use:controls={game}
		oncontextmenu={preventDefault}
		onsave={save.soon}
	>
		{#each $visibleTiles as visibleTile, i (visibleTile.key)}
			<Tile
				i={visibleTile.index}
				solved={game.solved}
				{game}
				cx={visibleTile.x}
				cy={visibleTile.y}
				controlMode={$settings.controlMode}
			/>
		{/each}
		{#if !game.solved}
			{#each $visibleTiles as visibleTile, i (visibleTile.key)}
				<EdgeMarks i={visibleTile.index} {game} cx={visibleTile.x} cy={visibleTile.y} />
			{/each}
		{/if}
	</svg>
</div>

<style>
	svg {
		display: block;
		margin: auto;
		border: 1px solid var(--secondary-color);
	}
	/* win animation */
	.solved :global(.inside) {
		animation-name: win-inside;
		animation-duration: 1.5s;
		animation-timing-function: ease-out;
	}
	.solved :global(.sink) {
		animation-name: win-sink;
		animation-duration: 1.5s;
		animation-timing-function: ease-out;
	}
	@keyframes win-sink {
		50% {
			fill: white;
		}
	}
	@keyframes win-inside {
		50% {
			stroke: white;
		}
	}
	div.solve-button {
		text-align: center;
		padding: 0.5em;
	}
	button {
		color: var(--text-color);
		display: inline-block;
		min-height: 2em;
	}
</style>
