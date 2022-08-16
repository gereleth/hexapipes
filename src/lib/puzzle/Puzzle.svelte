<script>
	import { HexaGrid } from '$lib/puzzle/hexagrid';
	import { settings } from '$lib/stores';
	import { controls } from '$lib/puzzle/controls';
	import Tile from '$lib/puzzle/Tile.svelte';
	import { onMount, onDestroy, createEventDispatcher } from 'svelte';
	import { PipesGame } from '$lib/puzzle/game';

	export let width = 0;
	export let height = 0;
	/** @type {Number[]} */
	export let tiles = [];
	export let wrap = false;
	export let savedProgress;
	export let progressStoreName = '';

	// Remember the name that the puzzle was created with
	// to prevent accidental saving to another puzzle's progress
	// if a user navigates between puzzles directly via back/forward buttons
	const myProgressName = progressStoreName;

	let svgWidth = 500;
	let svgHeight = 500;

	let grid = new HexaGrid(width, height, wrap);
	let game = new PipesGame(grid, tiles, savedProgress);
	let solved = game.solved;

	const dispatch = createEventDispatcher();

	let innerWidth = 500;
	let innerHeight = 500;
	const pxPerCell = 60;

	const viewBox = grid.viewBox;
	$viewBox.width = Math.min(grid.XMAX - grid.XMIN, innerWidth / pxPerCell);
	$viewBox.height = Math.min(grid.YMAX - grid.YMIN, innerHeight / pxPerCell);
	const visibleTiles = grid.visibleTiles;

	export const startOver = function () {
		game.startOver();
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
		if (wrap) {
			svgWidth = Math.min(maxPixelWidth, pxPerCell * maxGridWidth);
		} else {
			svgWidth = maxPixelWidth;
		}
		svgHeight = Math.min(maxPixelHeight, pxPerCell * maxGridHeight);
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
		if (wrap) {
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
		dispatch('initialized');
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

	const save = createThrottle(saveProgress, 3000);

	$: if ($solved) {
		dispatch('solved');
	}
</script>

<svelte:window bind:innerWidth bind:innerHeight on:resize={resize} />

<div class="puzzle" class:solved={$solved}>
	<svg
		width={svgWidth}
		height={svgHeight}
		viewBox="{$viewBox.xmin} {$viewBox.ymin} {$viewBox.width} {$viewBox.height}"
		use:controls={game}
		on:contextmenu|preventDefault={() => {}}
		on:save={save.soon}
	>
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
		filter: hue-rotate(360deg);
		transition: filter 2s;
	}
</style>
