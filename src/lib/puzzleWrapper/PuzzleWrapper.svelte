<script>
	import { page } from '$app/stores';
	import { browser } from '$app/env';
	import { goto } from '$app/navigation';
	import Puzzle from '$lib/puzzle/Puzzle.svelte';
	import PuzzleButtons from '$lib/puzzleWrapper/PuzzleButtons.svelte';
	import Timer from '$lib/Timer.svelte';
	import Stats from '$lib/Stats.svelte';
	import { getSolves, getStats } from '$lib/stores';
  import { onMount } from 'svelte';

	/** @type {'hexagonal'|'hexagonal-wrap'} */
	export let category;
	/** @type {Number} */
	export let size;
	/** @type {Number} */
	export let puzzleId;
	/** @type {Number} */
	export let puzzlesCount;
	/** @type {Number} */
	export let width;
	/** @type {Number} */
	export let height;
	/** @type {Number[]} */
	export let tiles;

	let solved = false;

	let nextPuzzleId = 1;

	let previousParams = {
		size: 0,
		id: 0,
	};

	let solves; // a store of puzzles solve times
	let stats; // a store of puzzle time stats

    let pathname = ''
	let progressStoreName = '';
	let savedProgress;

    $: pathname = `/${category}/${size}/${puzzleId}`
	$: progressStoreName = pathname + '_progress';

	let solve = {
		puzzleId: -1,
		startedAt: -1,
		finishedAt: -1,
		pausedAt: -1,
		elapsedTime: -1
	};
	/** @type {import('$lib/puzzle/Puzzle.svelte').default}*/
	let puzzle;

	$: if (browser && $page.params) {
		if (size !== previousParams.size) {
			if (previousParams.size) {
				// console.log('changed size, pausing', previousParams.id)
				solves?.pause(previousParams.id);
			}
			// if a player used the back button
			// and went from puzzle of one size
			// directly to a puzzle of another size
			// then we need to update solves and stats
			solves = getSolves(pathname);
			stats = getStats(pathname);
		} else if (puzzleId !== previousParams.id) {
			if (previousParams.id) {
				// console.log('changed id, pausing', previousParams.id)
				solves?.pause(previousParams.id);
			}
		}
		solved = false;
		const progress = window.localStorage.getItem(progressStoreName);
		if (progress !== null) {
			savedProgress = JSON.parse(progress);
		} else {
			savedProgress = undefined;
		}
	}

	function start() {
		previousParams.size = size;
		previousParams.id = puzzleId;
		if (solves !== undefined) {
			solve = solves.reportStart(puzzleId);
		}
		nextPuzzleId = solves.choosePuzzleId(puzzlesCount, puzzleId);
	}

	function stop() {
		solved = true;
		solve = solves.reportFinish(puzzleId);
		window.localStorage.removeItem(progressStoreName);
	}

	function saveProgress(event) {
		const { data, name } = event.detail;
		const dataStr = JSON.stringify(data);
		window.localStorage.setItem(name, dataStr);
	}

	function startOver() {
		solved = false;
		puzzle.startOver();
	}

	function newPuzzle() {
		goto(`/${category}/${size}/${nextPuzzleId}`);
	}

	onMount(() => {
		function handleVisibilityChange(e) {
			// console.log(`got visibility change event: ${document.visibilityState}`)
			if (document.visibilityState === 'visible') {
				solve = solves.unpause(puzzleId);
			} else {
				solve = solves.pause(puzzleId);
			}
		}

		document.addEventListener('visibilitychange', handleVisibilityChange);
		return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
	});

</script>

{#key `/${category}/${size}/${puzzleId}`}
	<Puzzle
		{width}
		{height}
		{tiles}
		wrap={category==='hexagonal-wrap'}
		{savedProgress}
		{progressStoreName}
		bind:this={puzzle}
		on:solved={stop}
		on:initialized={start}
		on:progress={saveProgress}
		on:pause={() => solves.pause(puzzleId)}
	/>
{/key}

<div class="container">
	<div class="congrat">
		{#if solve.elapsedTime !== -1}
			{#if solved}
				Solved!
			{/if}
			<a href="/{category}/{size}/{nextPuzzleId}">Next puzzle</a>
		{/if}
	</div>
	<PuzzleButtons
		solved={solve.elapsedTime !== -1}
		on:startOver={startOver}
		on:newPuzzle={newPuzzle}
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
