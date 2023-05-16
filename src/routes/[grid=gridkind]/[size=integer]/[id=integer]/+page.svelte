<script>
	import { page } from '$app/stores';
	import PuzzleKindWrapper from '$lib/puzzleWrapper/PuzzleKindWrapper.svelte';

	/** @type {import('./$types').PageData} */
	export let data;
</script>

<svelte:head>
	<title>
		{$page.params.size}x{$page.params.size} Hexagonal Pipes Puzzle #{$page.params.id}
	</title>
</svelte:head>

<PuzzleKindWrapper
	width={data.width}
	height={data.height}
	tiles={data.tiles}
	category={$page.params.grid}
	size={Number($page.params.size)}
	puzzleId={Number($page.params.id)}
/>
