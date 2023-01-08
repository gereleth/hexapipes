<script>
	import { page } from '$app/stores';
	import PuzzleWrapper from '$lib/puzzleWrapper/PuzzleWrapper.svelte';
</script>

<svelte:head>
	<title>
		{$page.params.size}x{$page.params.size} Hexagonal Pipes Puzzle
	</title>
</svelte:head>

<div class="info container">
	<h2>{$page.params.size}x{$page.params.size} Hexagonal Pipes Puzzle</h2>

	<p>Rotate the tiles so that all pipes are connected with no loops.</p>
</div>

<PuzzleWrapper
	width={Number($page.params.size)}
	height={Number($page.params.size)}
	tiles={[]}
	category={'hexagonal'}
	size={Number($page.params.size)}
	puzzleId={-1}
/>

<style>
	p {
		text-align: center;
	}
	.info {
		text-align: center;
	}
</style>
