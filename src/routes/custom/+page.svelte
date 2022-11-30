<script>
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import Puzzle from '$lib/puzzle/Puzzle.svelte';
	import Settings from '$lib/settings/Settings.svelte';
	import PuzzleButtons from '$lib/puzzleWrapper/PuzzleButtons.svelte';
	import Timer, { formatTime } from '$lib/Timer.svelte';
	import Stats from '$lib/Stats.svelte';
	import { getSolves, getStats, settings } from '$lib/stores';
	import { HexaGrid } from '$lib/puzzle/hexagrid';
	import { Generator } from '$lib/puzzle/generator';
	import { Solver } from '$lib/puzzle/solver';

	let width = 5;
	let height = 5;
	let wrap = false;
	/** @type {import('$lib/puzzle/Puzzle.svelte').default}*/
	let puzzle;
	let solved = false;

	let grid;
	/** @type {Number[]}*/
	let tiles = [];

	let id = 0;

	function generate() {
		grid = new HexaGrid(width, height, wrap);
		id += 1;
		const gen = new Generator(grid);
		tiles = gen.generate();
	}

	function startOver() {
		solved = false;
		puzzle.startOver();
	}

	onMount(() => generate());
</script>

<svelte:head>
	<title>Custom Pipes Puzzle</title>
</svelte:head>

<div class="info container">
	<h1>Custom Pipes Puzzle</h1>
	<p>Rotate the tiles so that all pipes are connected with no loops.</p>
	<p>⚠️ Custom puzzle page does not save the generated puzzle or your progress!</p>
</div>

<div class="generator-params container">
	<label for="width">
		Width
		<input type="number" name="width" id="width" bind:value={width} />
	</label>
	<label for="height">
		Height
		<input type="number" name="height" id="height" bind:value={height} />
	</label>
	<label for="wrap">
		Wrap
		<input type="checkbox" name="wrap" id="wrap" bind:checked={wrap} />
	</label>
	<button on:click={generate}>Generate</button>
</div>

<div class="container">
	<Settings />
</div>

{#if id > 0}
	{#key id}
		<Puzzle
			{width}
			{height}
			{tiles}
			{wrap}
			bind:this={puzzle}
			on:solved={() => (solved = true)}
			showSolveButton={true}
		/>
	{/key}
{/if}

<div class="container">
	<PuzzleButtons
		solved={true}
		on:startOver={startOver}
		includeNewPuzzleButton={true}
		on:newPuzzle={generate}
	/>
</div>

<div class="container instructions">
	<h2>The rules</h2>
	<ul>
		<li>All pipes must form a single contiguous network.</li>
		<li>No connections may run outside the grid.</li>
		<li>Bulb-shaped tiles are deadends.</li>
		<li>Closed loops are not allowed.</li>
		<li>Each puzzle has a unique solution.</li>
	</ul>

	<h2>Tips for controls</h2>
	<ul>
		<li>Click or tap a tile to rotate it.</li>
		<li>
			Lock tiles when you're sure of their orientation. Right click or long press to start locking.
			You can lock multiple tiles by moving the cursor around after that.
		</li>
		<li>
			Make edge marks to mark certain edges as "definitely a wall" or "definitely a connection". <br
			/>
			To make a wall mark draw a line along tile edge with a mouse or your finger. Draw a line across
			the edge for a connection mark. Do the same again to erase.<br />
			With a mouse or touch pad you can also click and hold near the edge middle to make a mark. In this
			case left mouse button makes a wall mark, right button makes a connection mark.
		</li>
		<li>
			Zoom in and out using mouse wheel or pinch-to-zoom on mobile. Click and drag to move around
			the board.
		</li>
		<li>Check out alternative control modes in the settings (top left of the puzzle).</li>
	</ul>
</div>

<style>
	.info {
		text-align: center;
	}
	.instructions,
	.generator-params {
		color: var(--text-color);
	}
	button {
		color: var(--text-color);
		min-height: 2em;
	}
</style>
