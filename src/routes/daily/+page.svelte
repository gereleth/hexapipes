<script>
	import PuzzleWrapper from '$lib/puzzleWrapper/PuzzleWrapper.svelte';
	/** @type {import('./$types').PageData} */
	export let data;
</script>

<svelte:head>
	<title>
		Daily Pipes Puzzle {data.date}
	</title>
</svelte:head>

<div class="info container">
	<h2>Daily Pipes Puzzle {data.date}</h2>

	<p>Rotate the tiles so that all pipes are connected with no loops.</p>
</div>

<PuzzleWrapper
	width={data.width}
	height={data.height}
	tiles={data.tiles}
	category={data.grid}
	size={-1}
	puzzleId={data.date}
	puzzlesCount={1}
/>

<style>
	.info {
		text-align: center;
	}
</style>
