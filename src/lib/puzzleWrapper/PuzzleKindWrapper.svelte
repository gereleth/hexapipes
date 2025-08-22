<script>
	import { onMount } from 'svelte';
	import { getSolves, getStats } from '$lib/stores';
	import { goto } from '$app/navigation';

	import Stats from '$lib/Stats.svelte';
	import PuzzleInstanceWrapper from './PuzzleInstanceWrapper.svelte';

	
	
	
	
	
	
	/**
	 * @typedef {Object} Props
	 * @property {import('$lib/puzzle/grids/grids').GridCategory} category
	 * @property {Number} size
	 * @property {Number} puzzleId
	 * @property {Number} width
	 * @property {Number} height
	 * @property {Number[]} [tiles]
	 */

	/** @type {Props} */
	let {
		category,
		size,
		puzzleId,
		width,
		height,
		tiles = []
	} = $props();

	/** @type {import('$lib/stores').SolvesStore}*/
	let solves = $state();
	/** @type {import('$lib/stores').StatsStore}*/
	let stats = $state();

	let pathname = $derived(`/${category}/${size}/${puzzleId}`);
	let progressStoreName = $derived(pathname + '_progress');
	let instanceStoreName = $derived(`/${category}/${size}` + '_instance');
	let wrap = $derived(category.endsWith('-wrap'));
	let gridKind = $derived(category.split('-')[0]);

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
