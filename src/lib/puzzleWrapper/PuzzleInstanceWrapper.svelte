<script>
	import { onMount } from 'svelte';
	import { page } from '$app/state';

	import { createGrid } from '$lib/puzzle/grids/grids';
	import GeneratorComponent from '$lib/puzzle/GeneratorComponent.svelte';
	import Puzzle from '$lib/puzzle/Puzzle.svelte';
	import PuzzleButtons from '$lib/puzzleWrapper/PuzzleButtons.svelte';
	import Timer from '$lib/Timer.svelte';
	import { goto } from '$app/navigation';

	/**
	 * @typedef {Object} Props
	 * @property {import('$lib/puzzle/grids/grids').GridKind} gridKind
	 * @property {Number} width
	 * @property {Number} height
	 * @property {Boolean} wrap
	 * @property {Number[]} tiles
	 * @property {any} [puzzleId]
	 * @property {String} progressStoreName
	 * @property {String} instanceStoreName
	 * @property {import('$lib/solvelogs.svelte').SolvesLog} solvesLog
	 */

	/** @type {Props} */
	let {
		gridKind,
		width,
		height,
		wrap,
		tiles = $bindable(),
		puzzleId = -1,
		progressStoreName,
		instanceStoreName,
		solvesLog
	} = $props();

	/** @type {import('$lib/solvelogs.svelte').Solve} */
	let solve = $state({
		puzzleId: -1,
		startedAt: -1,
		pausedAt: -1,
		elapsedTime: -1
	});

	let genId = $state(0);

	/** @type {GeneratorComponent|undefined} */
	let generatorComponent = $state();
	/** @type {Puzzle|undefined}*/
	let puzzle = $state();

	let grid = createGrid(gridKind, width, height, wrap);

	/** @type {import('$lib/puzzle/game.svelte').Progress|undefined} */
	let savedProgress = $state();
	/** @type {Number|undefined}*/
	let pxPerCell = $state();
	let solved = $state(false);
	let mounted = $state(false);

	/**
	 * @param {{ data: any; name: String }} progressData
	 */
	function saveProgress(progressData) {
		const { data, name } = progressData;
		const dataStr = JSON.stringify(data);
		window.localStorage.setItem(name, dataStr);
	}

	function startOver() {
		solved = false;
		puzzle?.startOver();
	}

	function start() {
		solve = solvesLog.reportStart(puzzleId);
	}

	function stop() {
		solved = true;
		solve = solvesLog.reportFinish(puzzleId);
		window.localStorage.removeItem(progressStoreName);
		if (puzzleId === -1) {
			window.localStorage.removeItem(instanceStoreName);
		}
	}

	function pause() {
		solvesLog.pause(puzzleId);
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
		generatorComponent?.generate(
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
			solvesLog.skip();
			window.localStorage.removeItem(progressStoreName);
			window.localStorage.removeItem(instanceStoreName);
		}
		if (puzzleId !== -1) {
			goto(`/${page.params.grid}/${page.params.size}`, { replaceState: true });
		} else {
			pxPerCell = puzzle?.reportPxPerCell();
			generatePuzzle();
		}
	}

	/**
	 * @param {{tiles: Number[]}} data
	 */
	function onGenerated(data) {
		tiles = data.tiles;
		genId += 1;
		window.localStorage.setItem(instanceStoreName, JSON.stringify({ tiles }));
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
				const result = solvesLog.unpause(puzzleId);
				if (result !== undefined) {
					solve = result;
				}
			} else {
				const result = solvesLog.pause(puzzleId);
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
		generated={onGenerated}
		errored={() => {}}
		canceled={() => {}}
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
			started={start}
			finished={stop}
			progress={saveProgress}
			paused={pause}
		/>
	{/key}
{/if}

<div class="container">
	<div class="congrat">
		{#if solve.elapsedTime !== -1}
			{#if solved}
				Solved!
			{/if}
			<a href="/{page.params.grid}/{page.params.size}" data-sveltekit-noscroll onclick={newPuzzle}
				>Next puzzle</a
			>
		{/if}
	</div>
	<PuzzleButtons
		solved={solve.elapsedTime !== -1}
		{startOver}
		{newPuzzle}
		download={() => puzzle?.download()}
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
