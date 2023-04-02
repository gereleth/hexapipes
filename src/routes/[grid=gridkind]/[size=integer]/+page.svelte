<script>
	import { page } from '$app/stores';
	import PuzzleWrapper from '$lib/puzzleWrapper/PuzzleWrapper.svelte';
	let title = '';

	$: if ($page.params.grid.startsWith('hexagonal')) {
		title = 'Hexagonal Pipes';
	} else if ($page.params.grid.startsWith('square')) {
		title = 'Square Pipes';
	} else if ($page.params.grid.startsWith('octagonal')) {
		title = 'Octagonal Pipes';
	}
</script>

<svelte:head>
	<title>
		{$page.params.size}x{$page.params.size}
		{title} Puzzle
	</title>
</svelte:head>

<div class="info container">
	<h2>{$page.params.size}x{$page.params.size} {title} Puzzle</h2>

	<p>Rotate the tiles so that all pipes are connected with no loops.</p>
</div>

<PuzzleWrapper
	width={Number($page.params.size)}
	height={Number($page.params.size)}
	tiles={[]}
	category={$page.params.grid}
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
