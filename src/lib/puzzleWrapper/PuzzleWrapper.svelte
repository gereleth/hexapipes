<script>
	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import Puzzle from '$lib/puzzle/Puzzle.svelte';
	import PuzzleButtons from '$lib/puzzleWrapper/PuzzleButtons.svelte';
	import Timer from '$lib/Timer.svelte';
	import Stats from '$lib/Stats.svelte';
	import { getSolves, getStats } from '$lib/stores';
	import { onMount } from 'svelte';
	import { Generator } from '$lib/puzzle/generator';
	import { HexaGrid } from '$lib/puzzle/grids/hexagrid';
	import { SquareGrid } from '$lib/puzzle/grids/squaregrid';

	/** @type {'hexagonal'|'hexagonal-wrap'|'square'|'square-wrap'} */
	export let category;
	/** @type {Number} */
	export let size;
	/** @type {Number} */
	export let puzzleId;
	/** @type {Number} */
	export let width;
	/** @type {Number} */
	export let height;
	/** @type {Number[]} */
	export let tiles;

	let solved = false;

	let previousParams = {
		size: 0,
		id: 0,
		category: 'hexagonal'
	};
	let genId = 1;
	/** @type {import('$lib/stores').SolvesStore}*/
	let solves;
	/** @type {import('$lib/stores').StatsStore}*/
	let stats;

	let pathname = '';
	let progressStoreName = '';
	/** @type {import('$lib/puzzle/game').Progress|undefined} */
	let savedProgress;
	/** @type {Number|undefined}*/
	let pxPerCell;

	$: pathname = `/${category}/${size}/${puzzleId}`;
	$: progressStoreName = pathname + '_progress';
	$: instanceStoreName = `/${category}/${size}` + '_instance';
	$: wrap = category.endsWith('-wrap');
	$: gridKind = category.split('-')[0];

	/** @type {import('$lib/stores').Solve} */
	let solve = {
		puzzleId: -1,
		startedAt: -1,
		pausedAt: -1,
		elapsedTime: -1,
		error: undefined
	};
	/** @type {import('$lib/puzzle/Puzzle.svelte').default}*/
	let puzzle;

	// @ts-ignore
	function reactToNavigation(...args) {
		if (size !== previousParams.size || category !== previousParams.category) {
			if (previousParams.size) {
				solves?.pause(previousParams.id);
			}
			// if a player used the back button
			// and went from puzzle of one size
			// directly to a puzzle of another size
			// then we need to update solves and stats
			solves = getSolves(pathname);
			stats = getStats(pathname);
			pxPerCell = undefined;
			if (puzzleId === -1) {
				// I don't know why this is necessary but it is
				// (in case of switching between static and random puzzles)
				tiles = [];
				// redirect to unfinished non-random puzzle if there is one
				// to avoid interrupting player's streak
				const haveUnfinishedBusiness =
					$solves.length > 0 && $solves[0].puzzleId !== -1 && $solves[0].elapsedTime === -1;
				if (haveUnfinishedBusiness) {
					const id = $solves[0].puzzleId;
					goto(`/${category}/${size}/${id}`, { replaceState: true });
				} else {
					getRandomPuzzle();
				}
			}
		} else if (puzzleId !== previousParams.id) {
			if (previousParams.id) {
				// console.log('changed id, pausing', previousParams.id)
				solves?.pause(previousParams.id);
				pxPerCell = puzzle.reportPxPerCell();
			}
		} else if (puzzleId === -1) {
			// switching from one random puzzle to another
			// remove progress data to avoid reuse
			window.localStorage.removeItem(progressStoreName);
			pxPerCell = puzzle.reportPxPerCell();
		}
		solved = false;
		const progress = window.localStorage.getItem(progressStoreName);
		if (progress !== null) {
			savedProgress = JSON.parse(progress);
		} else {
			savedProgress = undefined;
		}
	}

	$: if (browser) {
		reactToNavigation($page.params, genId);
	}

	function start() {
		previousParams.size = size;
		previousParams.id = puzzleId;
		previousParams.category = category;
		if (solves !== undefined) {
			solve = solves.reportStart(puzzleId);
		}
	}

	function stop() {
		solved = true;
		solve = solves.reportFinish(puzzleId);
		window.localStorage.removeItem(progressStoreName);
		if (puzzleId === -1) {
			window.localStorage.removeItem(instanceStoreName);
		}
	}

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

	function getRandomPuzzle() {
		const instance = window.localStorage.getItem(instanceStoreName);
		if (instance !== null) {
			tiles = JSON.parse(instance).tiles;
		} else {
			generatePuzzle();
		}
	}

	function generatePuzzle() {
		if (puzzleId !== -1) {
			return;
		}
		let grid;
		let branchingAmount = 0.6;
		let avoidObvious = 0;
		let avoidStraights = 0;
		if (category.startsWith('hexagonal')) {
			grid = new HexaGrid(width, height, wrap);
		} else {
			grid = new SquareGrid(width, height, wrap);
			branchingAmount = Math.random() * 0.5 + 0.5; // 0.5 to 1
			avoidObvious = Math.random() * 0.5 + 0.1; // 0.1 to 0.6
			avoidStraights = Math.random() * 0.5 + 0.25; // 0.25 to 0.75
		}
		const gen = new Generator(grid);
		tiles = gen.generate(branchingAmount, avoidObvious, avoidStraights);
		genId += 1;
		window.localStorage.setItem(instanceStoreName, JSON.stringify({ tiles: tiles }));
	}

	function newPuzzle() {
		if (!solved) {
			solves.skip();
			window.localStorage.removeItem(progressStoreName);
			window.localStorage.removeItem(instanceStoreName);
		}
		generatePuzzle();
	}

	onMount(() => {
		function handleVisibilityChange() {
			// console.log(`got visibility change event: ${document.visibilityState}`)
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
		return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
	});
</script>

{#if tiles.length > 0}
	{#key `/${category}/${size}/${puzzleId === -1 ? genId : puzzleId}`}
		<Puzzle
			{gridKind}
			{width}
			{height}
			{tiles}
			{wrap}
			{savedProgress}
			{progressStoreName}
			preferredPxPerCell={pxPerCell}
			bind:this={puzzle}
			on:solved={stop}
			on:initialized={start}
			on:progress={saveProgress}
			on:pause={() => solves.pause(puzzleId)}
		/>
	{/key}
{/if}

<div class="container">
	<div class="congrat">
		{#if solve.elapsedTime !== -1}
			{#if solved}
				Solved!
			{/if}
			<a href="/{category}/{size}" data-sveltekit-noscroll on:click={generatePuzzle}>Next puzzle</a>
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
{#if stats}
	<div class="stats">
		<Stats {stats} />
	</div>
{/if}

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
