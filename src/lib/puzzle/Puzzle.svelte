<script>
	import { settings } from '$lib/stores';
	import { controls } from '$lib/puzzle/controls';
	import Tile from '$lib/puzzle/Tile.svelte';
	import ClipPolygon from '$lib/puzzle/ClipPolygon.svelte';
	import { onMount, onDestroy, createEventDispatcher, tick } from 'svelte';
	import { PipesGame } from '$lib/puzzle/game';
	import { Solver } from './solver';
	import EdgeMarks from './EdgeMarks.svelte';

	/** @type {import('$lib/puzzle/grids/abstractgrid').AbstractGrid}*/
	export let grid;
	/** @type {Number[]} */
	export let tiles = [];
	/** @type {import('$lib/puzzle/game').Progress|undefined}*/
	export let savedProgress = undefined;
	export let progressStoreName = '';
	/** @type {Number|undefined} */
	export let preferredPxPerCell = undefined;
	export let showSolveButton = false;
	export let animate = false;

	// Remember the name that the puzzle was created with
	// to prevent accidental saving to another puzzle's progress
	// if a user navigates between puzzles directly via back/forward buttons
	const myProgressName = progressStoreName;

	let svgWidth = 500;
	let svgHeight = 500;

	let game = new PipesGame(grid, tiles, savedProgress);
	let solved = game.solved;

	const dispatch = createEventDispatcher();

	let innerWidth = 500;
	let innerHeight = 500;
	const pxPerCell = 60;

	const viewBox = game.viewBox;
	$viewBox.width = Math.min(grid.XMAX - grid.XMIN, innerWidth / pxPerCell);
	$viewBox.height = Math.min(grid.YMAX - grid.YMIN, innerHeight / pxPerCell);
	const visibleTiles = viewBox.visibleTiles;

	export const startOver = function () {
		game.startOver();
	};

	export const reportPxPerCell = function () {
		return svgWidth / $viewBox.width;
	};

	/**
	 * @param {Number} innerWidth
	 * @param {Number} innerHeight
	 * @returns {void}
	 */
	function initialResize(innerWidth, innerHeight) {
		// take full width without scroll bar
		const maxPixelWidth = innerWidth - 18;
		// take most height, leave some for scrolling the page on mobile
		const maxPixelHeight = $settings.disableZoomPan ? innerHeight : Math.round(0.8 * innerHeight);

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
		const pxPerCell = svgWidth / $viewBox.width;
		// take full width without scroll bar
		const maxPixelWidth = innerWidth - 18;
		// take most height, leave some for scrolling the page on mobile
		const maxPixelHeight = Math.round(0.8 * innerHeight);
		if (grid.wrap) {
			svgWidth = Math.min(maxPixelWidth, pxPerCell * $viewBox.width);
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
		initialResize(innerWidth, innerHeight);
		dispatch('start');
		// unleashTheSolver();
	});

	onDestroy(() => {
		// save progress immediately if navigating away (?)
		save.clear();
		if (!$solved) {
			save.now();
			dispatch('pause');
		}
	});

	function createThrottle(callback, timeout) {
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
		if ($solved) {
			return;
		}
		const tileStates = game.tileStates.map((tile) => {
			const data = tile.data;
			return {
				rotations: data.rotations,
				locked: data.locked,
				color: data.color,
				edgeMarks: data.edgeMarks
			};
		});
		dispatch('progress', {
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
	 * @type {import('$lib/puzzle/solver').Solver}
	 */
	let solver;
	let numsol = 0;
	export async function unleashTheSolver() {
		measureSolveTime();
		if (!$solved) {
			// unlock all tiles
			for (let tileState of game.tileStates) {
				if (tileState.data.locked) {
					tileState.toggleLocked();
				}
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
						await sleep(200);
					}
				}
				if (solver.solutions.length > 1) {
					// unlock tiles that are different between solutions
					// and lock those that are the same
					game.solved.set(false);
					game._solved = false;
					for (let [i, tile] of solver.solutions[0].entries()) {
						const isSame = solver.solutions.every((solution) => solution[i] === tile);
						if (game.tileStates[i].data.locked !== isSame) {
							game.tileStates[i].toggleLocked();
						}
					}
				}
			} catch (error) {
				console.error(error);
			}
		}
	}

	let steps = -1;
	let ms = -1;
	/** @type {Number[]}*/
	let msStats = [];
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
		numsol = solver.solutions.length;
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

	$: if ($solved) {
		dispatch('solved');
	}
</script>

<svelte:window bind:innerWidth bind:innerHeight on:resize={resize} />

{#if showSolveButton}
	<div class="solve-button">
		<button on:click={unleashTheSolver}>🧩 Solve it</button>
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
			<div>Number of solutions: {numsol}</div>
			{#if numsol > 1}
				<div>
					{#each solver.solutions as solution, i}
						<button
							on:click={() => {
								solution.forEach((orientation, index) => {
									game.setTileOrientation(index, orientation);
									game._solved = false;
								});
								game.solved.set(false);
								game._solved = false;
							}}
							>Solution {i + 1}
						</button>
					{/each}
				</div>
			{/if}
		{/if}
	</div>
{/if}

<div class="puzzle animation-{$settings.animationSpeed}" class:solved={$solved}>
	<svg
		width={svgWidth}
		height={svgHeight}
		viewBox="{$viewBox.xmin} {$viewBox.ymin} {$viewBox.width} {$viewBox.height}"
		use:controls={game}
		on:contextmenu|preventDefault={() => {}}
		on:save={save.soon}
	>
		<defs> 
			{#each $visibleTiles as visibleTile, i (visibleTile.key)}
				<ClipPolygon
					i={visibleTile.index}
					{game}
					cx={visibleTile.x}
					cy={visibleTile.y}
				/>
			{/each}
		</defs>
		{#each $visibleTiles as visibleTile, i (visibleTile.key)}
			<Tile
				i={visibleTile.index}
				solved={$solved}
				{game}
				cx={visibleTile.x}
				cy={visibleTile.y}
				controlMode={$settings.controlMode}
			/>
		{/each}
		{#if !$solved}
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
