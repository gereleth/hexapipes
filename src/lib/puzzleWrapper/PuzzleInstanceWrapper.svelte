<script>
	import { onMount } from 'svelte';
	import { page } from '$app/stores';

	import { createGrid } from '$lib/puzzle/grids/grids';
	import GeneratorComponent from '$lib/puzzle/GeneratorComponent.svelte';
	import Puzzle from '$lib/puzzle/Puzzle.svelte';
	import PuzzleButtons from '$lib/puzzleWrapper/PuzzleButtons.svelte';
	import Timer from '$lib/Timer.svelte';
	import { goto } from '$app/navigation';

	/** @type {import('$lib/puzzle/grids/grids').GridKind} */
	export let gridKind;
	/** @type {Number} */
	export let width;
	/** @type {Number} */
	export let height;
	/** @type {Boolean} */
	export let wrap;
	/** @type {Number[]} */
	export let tiles;

	export let puzzleId = -1;
	/** @type {String}*/
	export let progressStoreName;
	/** @type {String}*/
	export let instanceStoreName;
	/** @type {import('$lib/stores').SolvesStore}*/
	export let solves;

	/** @type {import('$lib/stores').Solve} */
	let solve = {
		puzzleId: -1,
		startedAt: -1,
		pausedAt: -1,
		elapsedTime: -1,
		error: undefined
	};

	let genId = 0;

	/** @type {GeneratorComponent} */
	let generatorComponent;
	/** @type {Puzzle}*/
	let puzzle;

	let grid = createGrid(gridKind, width, height, wrap);

	/** @type {import('$lib/puzzle/game').Progress|undefined} */
	let savedProgress;
	/** @type {Number|undefined}*/
	let pxPerCell;
	let solved = false;
	let mounted = false;

	/**
	 * @param {{ detail: { data: any; name: String; }; }} event
	 */
	function saveProgress(event) {
		const { data, name } = event.detail;
		const dataStr = JSON.stringify(data);
		window.localStorage.setItem(name, dataStr);
	}

	function startOver() {
		solved = false;
		puzzle.startOver();
	}

	function start() {
		solve = solves.reportStart(puzzleId);
	}

	function stop() {
		solved = true;
		solve = solves.reportFinish(puzzleId);
		window.localStorage.removeItem(progressStoreName);
		if (puzzleId === -1) {
			window.localStorage.removeItem(instanceStoreName);
		}
	}

	function pause() {
		solves.pause(puzzleId);
	}

	function generatePuzzle() {
		if (puzzleId !== -1) {
			return;
		}
		solved = false;
		savedProgress = undefined;
		let branchingAmount = 0.6;
		let avoidObvious = 0;
		let avoidStraights = 0;
		if (
			gridKind === 'square' ||
			gridKind === 'etrat' ||
			gridKind === 'cube' ||
			gridKind === 'rhombitrihexagonal'
		) {
			branchingAmount = Math.random() * 0.5 + 0.5; // 0.5 to 1
			avoidObvious = Math.random() * 0.5 + 0.1; // 0.1 to 0.6
			avoidStraights = Math.random() * 0.5 + 0.25; // 0.25 to 0.75
		} else if (gridKind === 'triangular') {
			branchingAmount = 0;
		}
		generatorComponent.generate(
			{
				branchingAmount,
				avoidObvious,
				avoidStraights,
				solutionsNumber: 'unique'
			},
			grid
		);
	}

	function newPuzzle() {
		if (!solved) {
			solves.skip();
			window.localStorage.removeItem(progressStoreName);
			window.localStorage.removeItem(instanceStoreName);
		}
		if (puzzleId !== -1) {
			goto(`/${$page.params.grid}/${$page.params.size}`, { replaceState: true });
		} else {
			pxPerCell = puzzle.reportPxPerCell();
			generatePuzzle();
		}
	}

	/**
	 * @param {{detail: {tiles: Number[]}}} event
	 */
	function onGenerated(event) {
		tiles = event.detail.tiles;
		genId += 1;
		window.localStorage.setItem(instanceStoreName, JSON.stringify({ tiles: tiles }));
	}

	onMount(() => {
		if (puzzleId === -1) {
			const instance = window.localStorage.getItem(instanceStoreName);
			if (instance !== null) {
				tiles = JSON.parse(instance).tiles;
				// if the grid was refactored and handles size differently
				// then ignore the previously saved instance
				if (tiles.length !== grid.total) {
					tiles = [];
				}
			}
		}
		solved = false;
		if (tiles.length > 0) {
			const progress = window.localStorage.getItem(progressStoreName);
			if (progress !== null) {
				const saved = JSON.parse(progress);
				if (saved.tiles.length === tiles.length) {
					savedProgress = saved;
				} else {
					console.log('Saved progress length mismatched', saved);
					savedProgress = undefined;
				}
			} else {
				savedProgress = undefined;
			}
		} else {
			generatePuzzle();
		}

		function handleVisibilityChange() {
			if (document.visibilityState === 'visible') {
				const result = solves.unpause(puzzleId);
				if (result !== undefined) {
					solve = result;
				}
			} else {
				const result = solves.pause(puzzleId);
				if (result !== undefined) {
					solve = result;
				}
			}
		}

		document.addEventListener('visibilitychange', handleVisibilityChange);
		mounted = true;
		return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
	});
</script>

<div class="container">
	<GeneratorComponent
		bind:this={generatorComponent}
		on:generated={onGenerated}
		on:error={() => {}}
		on:cancel={() => {}}
	/>
</div>

{#if mounted && tiles.length > 0}
	{#key `/${puzzleId}/${puzzleId === -1 ? genId : puzzleId}`}
		<Puzzle
			{grid}
			{tiles}
			{savedProgress}
			{progressStoreName}
			preferredPxPerCell={pxPerCell}
			bind:this={puzzle}
			on:start={start}
			on:solved={stop}
			on:progress={saveProgress}
			on:pause={pause}
		/>
	{/key}
{/if}

<div class="container">
	<div class="congrat">
		{#if solve.elapsedTime !== -1}
			{#if solved}
				Solved!
			{/if}
			<a
				href="/{$page.params.grid}/{$page.params.size}"
				data-sveltekit-noscroll
				on:click={newPuzzle}>Next puzzle</a
			>
		{/if}
	</div>
	<PuzzleButtons
		solved={solve.elapsedTime !== -1}
		on:startOver={startOver}
		on:newPuzzle={newPuzzle}
		on:download={puzzle.download}
	/>
</div>

<div class="timings">
	<Timer {solve} />
</div>

<style>
	.congrat {
		margin: auto;
		margin-bottom: 20px;
		font-size: 150%;
		color: var(--primary-color);
		text-align: center;
		min-height: 30px;
	}
</style>
