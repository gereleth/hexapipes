<script>
	import { page } from '$app/stores';
	import PuzzleWrapper from '$lib/puzzleWrapper/PuzzleWrapper.svelte';
	import { puzzleCounts } from '$lib/stores';

	/** @type {import('./$types').PageData} */
	export let data;
</script>

<svelte:head>
	<title>
		{$page.params.size}x{$page.params.size} Hexagonal Wrap Pipes Puzzle #{$page.params.id}
	</title>
</svelte:head>

<div class="info container">
	<h2>{$page.params.size}x{$page.params.size} Hexagonal Wrap Pipes Puzzle #{$page.params.id}</h2>

	<p>
		Rotate the tiles so that all pipes are connected with no loops. The puzzle wraps around and
		connects back to itself - left to right and top to bottom. Multiple copies of tiles are shown to
		help you solve.
	</p>
</div>

<PuzzleWrapper
	width={data.width}
	height={data.height}
	tiles={data.tiles}
	category={'hexagonal-wrap'}
	size={Number($page.params.size)}
	puzzleId={Number($page.params.id)}
/>

<style>
	.info {
		text-align: center;
	}
</style>
