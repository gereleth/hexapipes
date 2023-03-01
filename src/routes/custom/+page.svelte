<script>
	import { onMount } from 'svelte';
	import Grids from '$lib/header/Grids.svelte';
	import Puzzle from '$lib/puzzle/Puzzle.svelte';
	import PuzzleButtons from '$lib/puzzleWrapper/PuzzleButtons.svelte';
	import { HexaGrid } from '$lib/puzzle/hexagrid';
	import { Generator } from '$lib/puzzle/generator';

	let width = 5;
	let height = 5;
	let wrap = false;
	let branchingAmount = 0.6;
	let avoidObvious = false;
	/** @type {import('$lib/puzzle/generator').SolutionsNumber}*/
	let solutionsNumber = 'unique';
	let errorMessage = '';

	/** @type {import('$lib/puzzle/Puzzle.svelte').default}*/
	let puzzle;
	let solved = false;

	let grid;
	/** @type {Number[]}*/
	let tiles = [];

	let id = 0;

	function generate() {
		// ensure valid sizes
		// the game does not handle XS wraps well, so each size must be at least 3
		width = Math.max(width, wrap ? 3 : 1);
		height = Math.max(height, wrap ? 3 : 1);
		if (width * height === 1) {
			width += 1;
		}
		grid = new HexaGrid(width, height, wrap);
		id += 1;
		const gen = new Generator(grid);
		try {
			tiles = gen.generate(branchingAmount, avoidObvious, solutionsNumber);
			errorMessage = '';
		} catch (error) {
			console.error(error);
			errorMessage = '' + error;
		}
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

<div class="container">
	<h1>Hexagonal pipes</h1>
	<Grids />
</div>

<div class="info container">
	<h1>Custom Pipes Puzzle</h1>
	<p>Rotate the tiles so that all pipes are connected with no loops.</p>
	<p>⚠️ Custom puzzle page does not save the generated puzzle or your progress!</p>
</div>

<div class="generator-params container">
	<label for="width">
		Width
		<input type="number" name="width" id="width" bind:value={width} min="3" />
	</label>
	<label for="height">
		Height
		<input type="number" name="height" id="height" bind:value={height} min="3" />
	</label>
	<label for="wrap">
		Wrap
		<input type="checkbox" name="wrap" id="wrap" bind:checked={wrap} />
	</label>
	<button on:click={generate}>Generate</button>
	<details>
		<summary>More options</summary>
		<label for="branching">
			Branching amount
			<input
				type="range"
				min="0"
				max="1"
				step="0.05"
				name="branching"
				id="branching"
				bind:value={branchingAmount}
			/>
		</label>
		<label for="avoidObvious">
			Avoid obvious tiles along borders
			<input type="checkbox" name="wrap" id="wrap" bind:checked={avoidObvious} />
		</label>

		<label>
			Number of solutions
			<label for="unique">
				<input type="radio" bind:group={solutionsNumber} id="unique" value="unique" /> Unique
			</label>
			<label for="multiple">
				<input type="radio" bind:group={solutionsNumber} id="multiple" value="multiple" /> Multiple
			</label>
			<label for="whatever">
				<input type="radio" bind:group={solutionsNumber} id="whatever" value="whatever" /> Whatever
			</label>
		</label>
	</details>
	{#if errorMessage !== ''}
		<div class="error">{errorMessage}</div>
	{/if}
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

<div class="container buttons">
	<PuzzleButtons
		solved={true}
		on:startOver={startOver}
		includeNewPuzzleButton={true}
		on:newPuzzle={generate}
		on:download={puzzle.download}
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
	.generator-params {
		text-align: center;
	}
	button {
		color: var(--text-color);
		min-height: 2em;
	}
	input[type='number'] {
		max-width: 60px;
	}
	.buttons {
		margin-top: 20px;
	}
	details > label {
		display: block;
		margin-bottom: 1em;
	}
	.error {
		padding: 1em;
		background-color: rgba(255, 0, 0, 0.1);
	}
</style>
