<script>
	import { onMount } from 'svelte';
	import { getSolves } from '#lib/solvelogs.svelte.js';
	import { page } from '$app/state';
	import { parseGridCategory } from '#lib/puzzle/grids/grids.js';

	import Stats from '#lib/Stats.svelte';
	import PuzzleInstanceWrapper from './PuzzleInstanceWrapper.svelte';

	/**
	 * @typedef {Object} Props
	 * @property {import('#lib/puzzle/grids/grids.js').GridCategory} category
	 * @property {Number} size
	 * @property {Number} puzzleId
	 * @property {Number} width
	 * @property {Number} height
	 * @property {Number[]} [tiles=[]]
	 */

	/** @type {Props} */
	let { category, size, puzzleId, width, height, tiles = [] } = $props();

	/** @type {import('#lib/solvelogs.svelte.js').SolvesLog|undefined}*/
	let solvesLog = $state();

	let pathname = $derived(`/${category}/${size}/${puzzleId}`);
	let progressStoreName = $derived(pathname + '_progress');
	let instanceStoreName = $derived(`/${category}/${size}` + '_instance');
	let { kind: gridKind, wrap } = $derived(parseGridCategory(category));

	onMount(() => {
		solvesLog = getSolves(page.url.pathname);
		// drop a stale unfinished solve for a retired static instance, if any
		solvesLog.popUnfinishedLegacyInstance();
	});
</script>

{#if solvesLog}
	<PuzzleInstanceWrapper
		{puzzleId}
		{tiles}
		{gridKind}
		{width}
		{height}
		{wrap}
		{progressStoreName}
		{instanceStoreName}
		{solvesLog}
	/>
	<div class="stats">
		<Stats stats={solvesLog.stats} previousStats={solvesLog.previousStats} />
	</div>
{/if}
