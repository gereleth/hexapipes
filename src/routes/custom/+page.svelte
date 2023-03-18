<script>
	import { onMount, tick } from 'svelte';
	import Grids from '$lib/header/Grids.svelte';
	import Puzzle from '$lib/puzzle/Puzzle.svelte';
	import PuzzleButtons from '$lib/puzzleWrapper/PuzzleButtons.svelte';
	import { HexaGrid } from '$lib/puzzle/grids/hexagrid';
	import { SquareGrid } from '$lib/puzzle/grids/squaregrid';
	import { Generator } from '$lib/puzzle/generator';

	let gridKind = 'hexagonal';
	let width = 5;
	let height = 5;
	let wrap = false;
	let branchingAmount = 0.6;
	let avoidObvious = 0.0;
	let avoidStraights = 0.0;
	let autosolve = false;
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
	let animate = false;

	async function generate() {
		// ensure valid sizes
		// the game does not handle XS wraps well, so each size must be at least 3
		width = Math.max(width, wrap ? 3 : 1);
		height = Math.max(height, wrap ? 3 : 1);
		if (width * height === 1) {
			width += 1;
		}
		if (gridKind === 'hexagonal') {
			grid = new HexaGrid(width, height, wrap);
		} else {
			grid = new SquareGrid(width, height, wrap);
		}
		id += 1;
		const gen = new Generator(grid);
		try {
			tiles = gen.generate(branchingAmount, avoidObvious, avoidStraights, solutionsNumber);
			errorMessage = '';
		} catch (error) {
			console.error(error);
			errorMessage = '' + error;
		}
		if (autosolve) {
			await tick();
			puzzle.unleashTheSolver();
		}
	}

	function importPuzzle(event) {
		try {
			const data = JSON.parse(event.target.result);

			const w = Number(data.width);
			if (isNaN(w) || w < 2 || !Number.isInteger(w)) {
				throw `Invalid value for width: "${data.width}". Expected an integer >= 2`;
			}
			const h = Number(data.height);
			if (isNaN(h) || h < 2 || !Number.isInteger(h)) {
				throw `Invalid value for height: "${data.height}". Expected an integer >= 2`;
			}
			let wr = data.wrap;
			if (!(wr === true || wr === false)) {
				throw `Bad value for wrap: "${data.wrap}". Expected "true" or "false"`;
			}
			if (!data.tiles) {
				throw 'Tiles list not found';
			}
			const t = data.tiles;
			t.forEach((tile, index) => {
				if (isNaN(tile)) {
					throw `NaN value found in tiles list at index ${index}`;
				}
			});
			let gr;
			if (data.grid === 'hexagonal') {
				gr = new HexaGrid(w, h, wr, t);
			} else if (data.grid === 'square') {
				gr = new SquareGrid(w, h, wr, t);
			} else {
				throw `Bad value for grid: "${data.grid}". Expected "hexagonal" or "square"`;
			}
			if (w * h !== t.length) {
				throw `Size mismatch: width*height = ${w} * ${h} = ${w * h}, length of tiles = ${t.length}`;
			}
			t.forEach((tile, index) => {
				if (tile < 0 || tile > grid.fullyConnected(index)) {
					throw `Bad tile value at index ${index}: ${tile}`;
				}
			});
			// now it looks like the imported puzzle is ok
			width = w;
			height = h;
			wrap = wr;
			tiles = t;
			grid = gr;
			gridKind = data.grid;
			id += 1;
			errorMessage = '';
		} catch (error) {
			console.error(error);
			errorMessage = '' + error;
		}
	}

	function importFromFile(event) {
		const files = event.target.files;
		if (files.length <= 0) {
			// no data selected
			return false;
		}
		let fileReader = new FileReader();
		fileReader.onload = importPuzzle;
		fileReader.readAsText(files.item(0));
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
	<div style="margin-bottom: 0.5em">
		<label>
			Grid type
			<label for="hexagonal">
				<input type="radio" bind:group={gridKind} id="hexagonal" value="hexagonal" /> Hexagonal
			</label>
			<label for="square">
				<input type="radio" bind:group={gridKind} id="square" value="square" /> Square
			</label>
		</label>
	</div>
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
		<label for="avoidStraights">
			Avoid straight tiles
			<input
				type="range"
				min="0"
				max="1"
				step="0.05"
				name="avoidStraights"
				id="avoidStraights"
				bind:value={avoidStraights}
			/>
		</label>
		<label for="avoidObvious">
			Avoid obvious tiles along borders
			<input
				type="range"
				min="0"
				max="1"
				step="0.05"
				name="avoidObvious"
				id="avoidObvious"
				bind:value={avoidObvious}
			/>
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
		<label for="autosolve">
			<input type="checkbox" bind:checked={autosolve} id="autosolve" /> Autosolve immediately
		</label>
	</details>

	<label class="file-input" for="file-input"> Import from file </label>
	<input class="file-input" id="file-input" type="file" on:change={importFromFile} />

	{#if errorMessage !== ''}
		<div class="error">{errorMessage}</div>
	{/if}
</div>

{#if id > 0}
	{#key id}
		<Puzzle
			{gridKind}
			{width}
			{height}
			{tiles}
			{wrap}
			bind:this={puzzle}
			on:solved={() => (solved = true)}
			showSolveButton={true}
			bind:animate
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
		cursor: pointer;
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
	summary {
		padding: 0.5em 0;
	}
	input.file-input {
		display: none;
	}
	label.file-input {
		color: #888;
		text-decoration: underline;
		cursor: pointer;
	}
</style>
