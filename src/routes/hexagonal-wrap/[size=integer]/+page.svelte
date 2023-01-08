<script>
	import { page } from '$app/stores';
	import PuzzleWrapper from '$lib/puzzleWrapper/PuzzleWrapper.svelte';
</script>

<svelte:head>
	<title>
		{$page.params.size}x{$page.params.size} Hexagonal Wrap Pipes Puzzle
	</title>
</svelte:head>

<div class="info container">
	<h2>{$page.params.size}x{$page.params.size} Hexagonal Wrap Pipes Puzzle</h2>

	<p>
		Rotate the tiles so that all pipes are connected with no loops. The puzzle wraps around and
		connects back to itself - left to right and top to bottom. Multiple copies of tiles are shown to
		help you solve.
	</p>
</div>

<PuzzleWrapper
	width={Number($page.params.size)}
	height={Number($page.params.size)}
	tiles={[]}
	category={'hexagonal-wrap'}
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
