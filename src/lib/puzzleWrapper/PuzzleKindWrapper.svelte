<script>
	import { onMount } from 'svelte';
	import { getSolves, getStats } from '$lib/stores';
	import { goto } from '$app/navigation';

	import Stats from '$lib/Stats.svelte';
	import PuzzleInstanceWrapper from './PuzzleInstanceWrapper.svelte';

	/** @type {import('$lib/puzzle/grids/grids').GridCategory} */
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
	export let tiles = [];

	/** @type {import('$lib/stores').SolvesStore}*/
	let solves;
	/** @type {import('$lib/stores').StatsStore}*/
	let stats;

	$: pathname = `/${category}/${size}/${puzzleId}`;
	$: progressStoreName = pathname + '_progress';
	$: instanceStoreName = `/${category}/${size}` + '_instance';
	$: wrap = category.endsWith('-wrap');
	$: gridKind = category.split('-')[0];

	onMount(() => {
		solves = getSolves(pathname);
		stats = getStats(pathname);

		const haveUnfinishedBusiness =
			$solves.length > 0 && $solves[0].puzzleId !== -1 && $solves[0].elapsedTime === -1;
		if (haveUnfinishedBusiness) {
			const id = $solves[0].puzzleId;
			goto(`/${category}/${size}/${id}`, { replaceState: true });
		}
	});
</script>

{#if $solves}
	<PuzzleInstanceWrapper
		{puzzleId}
		{tiles}
		{gridKind}
		{width}
		{height}
		{wrap}
		{progressStoreName}
		{instanceStoreName}
		{solves}
	/>
{/if}

{#if stats}
	<div class="stats">
		<Stats {stats} />
	</div>
{/if}
