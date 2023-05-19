<script>
	import { onMount, tick } from 'svelte';
	import Puzzle from '$lib/puzzle/Puzzle.svelte';
	import PuzzleButtons from '$lib/puzzleWrapper/PuzzleButtons.svelte';
	import { createGrid } from '$lib/puzzle/grids/grids';
	import GeneratorComponent from '$lib/puzzle/GeneratorComponent.svelte';
	import Instructions from '$lib/Instructions.svelte';

	let state = 'idle';
	/** @type {import('$lib/puzzle/grids/grids').GridKind}*/
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
	/** @type {import('$lib/puzzle/GeneratorComponent.svelte').default}*/
	let generatorComponent;
	let solved = false;

	/** @type {import('$lib/puzzle/grids/grids').Grid}*/
	let grid;
	/** @type {Number[]}*/
	let tiles = [];

	let id = 0;
	let animate = false;

	function generate() {
		// ensure valid sizes
		// the game does not handle XS wraps well, so each size must be at least 3
		width = Math.max(width, wrap ? 3 : 1);
		height = Math.max(height, wrap ? 3 : 1);
		if (width * height === 1) {
			width += 1;
		}
		grid = createGrid(gridKind, width, height, wrap);
		generatorComponent.generate({
			branchingAmount,
			avoidObvious,
			avoidStraights,
			solutionsNumber
		});
		state = 'generating';
	}
	/**
	 *
	 * @param {{detail: {tiles: Number[]}}} event
	 */
	async function onGenerated(event) {
		id += 1;
		tiles = event.detail.tiles;
		errorMessage = '';
		state = 'idle';
		if (autosolve) {
			await tick();
			puzzle.unleashTheSolver();
		}
	}
	/**
	 *
	 * @param {{detail: String}} event
	 */
	function onError(event) {
		errorMessage = event.detail;
		state = 'idle';
	}

	function onCancel() {
		errorMessage = '';
		state = 'idle';
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
			let gr = createGrid(data.grid, w, h, wr, t);
			if (gr.total !== t.length) {
				throw `Size mismatch: grid total = ${gr.total}, length of tiles = ${t.length}`;
			}
			t.forEach((tile, index) => {
				if (tile < 0 || tile > gr.fullyConnected(index)) {
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
		if (files === null || files.length <= 0) {
			// no data selected
			return false;
		}
		let fileReader = new FileReader();
		fileReader.onload = importPuzzle;
		const file = files.item(0);
		if (file !== null) {
			fileReader.readAsText(file);
		}
	}

	function startOver() {
		solved = false;
		puzzle.startOver();
	}

	onMount(() => {
		generate();
	});
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
	<div style="margin-bottom: 0.5em">
		<label>
			Grid type
			<label for="hexagonal">
				<input type="radio" bind:group={gridKind} id="hexagonal" value="hexagonal" /> Hexagonal
			</label>
			<label for="square">
				<input type="radio" bind:group={gridKind} id="square" value="square" /> Square
			</label>
			<label for="octagonal">
				<input type="radio" bind:group={gridKind} id="octagonal" value="octagonal" /> Octagonal
			</label>
			<label for="etrat">
				<input type="radio" bind:group={gridKind} id="etrat" value="etrat" /> Elongated triangular
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
	<button on:click={generate} disabled={state === 'generating'}>Generate</button>
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

	<GeneratorComponent
		bind:this={generatorComponent}
		{gridKind}
		{width}
		{height}
		{wrap}
		on:generated={onGenerated}
		on:error={onError}
		on:cancel={onCancel}
	/>
	{#if errorMessage !== ''}
		<div class="error">{errorMessage}</div>
	{/if}
</div>

{#if id > 0}
	{#key id}
		<Puzzle
			{grid}
			{tiles}
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

<Instructions />

<style>
	.info {
		text-align: center;
	}
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
