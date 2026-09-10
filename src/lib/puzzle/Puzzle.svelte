<script>
	import { innerWidth, innerHeight } from 'svelte/reactivity/window';
	import { settings } from '$lib/stores';
	import { controls } from '$lib/puzzle/controls';
	import Tile from '$lib/puzzle/Tile.svelte';
	import LayeredTile from '$lib/puzzle/LayeredTile.svelte';
	import { onMount, onDestroy } from 'svelte';
	import { PipesGame } from '$lib/puzzle/game.svelte.js';
	import { LayeredPipesGame } from './game-layers.svelte';
	import { Solver } from './solver';
	import { LayeredSolver } from './solver-layers';
	import EdgeMarks from './EdgeMarks.svelte';

	/**
	 * @typedef {Object} Props
	 * @property {import('$lib/puzzle/grids/abstractgrid').AbstractGrid} grid
	 * @property {Number[]|Number[][]} [tiles]
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

	/** @type {PipesGame|LayeredPipesGame}*/
	let game;
	if (Number.isInteger(tiles[0])) {
		game = new PipesGame(grid, /** @type {Number[]} */ (tiles), savedProgress);
	} else {
		game = new LayeredPipesGame(
			grid,
			/** @type {Number[][]} */ (tiles),
			/** @type {import('$lib/puzzle/game-layers.svelte').LayeredProgress|undefined} */ (
				savedProgress
			)
		);
	}

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
		/** @type {Array<Record<String, any>>}*/
		let tileStates;
		if (game instanceof LayeredPipesGame) {
			tileStates = game.tileStates.map((data) => {
				return {
					rotations: data.rotations,
					locked: data.locked,
					colors: data.colors,
					edgeMarks: data.edgeMarks
				};
			});
		} else {
			tileStates = game.tileStates.map((data) => {
				return {
					rotations: data.rotations,
					locked: data.locked,
					color: data.color,
					edgeMarks: data.edgeMarks
				};
			});
		}
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
	 * @type {import('$lib/puzzle/solver').Solver|import('$lib/puzzle/solver-layers').LayeredSolver|undefined}
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
			if (game instanceof LayeredPipesGame) {
				const layeredGame = game;
				/** @type {import('$lib/puzzle/solver-layers').LayeredSolver} */
				const layeredSolver = new LayeredSolver(/** @type {Number[][]} */ (tiles), grid);
				solver = layeredSolver;
				try {
					for (let { stage, step } of layeredSolver.solve(true)) {
						if (stage === 'aftercheck') {
							continue;
						}
						game.toggleLocked(step.cell, false);
						const shouldLock = step.final && stage === 'initial';
						layeredGame.setTileOrientation(step.cell, step.rotation, !shouldLock);
						if (shouldLock) {
							game.toggleLocked(step.cell, true);
						}
						if (animate) {
							await sleep(100);
						}
					}
					if (layeredSolver.solutions.length > 1) {
						// unlock cells that are different between solutions
						// and lock those that are the same
						game.solved = false;
						for (let [i, id] of layeredSolver.solutions[0].entries()) {
							const isSame = layeredSolver.solutions.every((solution) => solution[i] === id);
							if (game.tileStates[i].locked !== isSame) {
								game.tileStates[i].toggleLocked();
							}
						}
					}
					// store rotations instead of picture ids for the solution buttons
					solutions = layeredSolver.solutions;
				} catch (error) {
					console.error(error);
				}
			} else {
				solver = new Solver(/** @type {Number[]} */ (tiles), grid);
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
	}

	let steps = $state(-1);
	let ms = $state(-1);
	/** @type {Number[]}*/
	let msStats = $state([]);
	function measureSolveTime() {
		const t0 = performance.now();
		/** @type {import('$lib/puzzle/solver').Solver|import('$lib/puzzle/solver-layers').LayeredSolver} */
		let measureSolver;
		if (game instanceof LayeredPipesGame) {
			measureSolver = new LayeredSolver(/** @type {Number[][]} */ (tiles), grid);
		} else {
			measureSolver = new Solver(/** @type {Number[]} */ (tiles), grid);
		}
		steps = 0;
		try {
			for (let _ of measureSolver.solve(true)) {
				steps += 1;
			}
		} catch (error) {
			console.log('unsolvable puzzle');
		}
		const t1 = performance.now();
		ms = t1 - t0;
		msStats.push(ms);
		msStats = msStats.sort((a, b) => a - b);
		// for layered puzzles these are picture ids, only the count is displayed
		// until unleashTheSolver replaces them with rotations
		solutions = /** @type {number[][]} */ (measureSolver.solutions);
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
					{#each solutions as solution, i (i)}
						<button
							onclick={() => {
								if (game instanceof LayeredPipesGame) {
									const layeredGame = game;
									solution.forEach((rotation, index) => {
										layeredGame.setTileOrientation(index, rotation);
										game.solved = false;
									});
								} else {
									const classicGame = /** @type {PipesGame} */ (game);
									solution.forEach((orientation, index) => {
										classicGame.setTileOrientation(index, orientation);
										game.solved = false;
									});
								}
								game.solved = false;
							}}>Solution {i + 1}</button
						>
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
			{#if game instanceof LayeredPipesGame}
				<LayeredTile
					i={visibleTile.index}
					solved={game.solved}
					{game}
					cx={visibleTile.x}
					cy={visibleTile.y}
					controlMode={$settings.controlMode}
				/>
			{:else if !(game instanceof LayeredPipesGame)}
				<Tile
					i={visibleTile.index}
					solved={game.solved}
					{game}
					cx={visibleTile.x}
					cy={visibleTile.y}
					controlMode={$settings.controlMode}
				/>
			{/if}
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
