<script>
	import { page } from '$app/stores';
	import { gridKinds, gridInfo } from '$lib/puzzle/grids/grids';
	import ExamplePuzzle from './ExamplePuzzle.svelte';

	function initializeGrid(exampleGrid, gridData) {
		if (gridData) exampleGrid.initialize(gridData);
		return exampleGrid;
	}
</script>

<div class="grids">
	{#each gridKinds as gridKind}
		{@const { url, title, exampleGrid, gridData, exampleTiles } = gridInfo[gridKind]}
		<a href="/{url}/5" class:active={$page.url.pathname.startsWith(`/${url}/`)}>
			{title}
			<ExamplePuzzle grid={initializeGrid(exampleGrid, gridData)} tiles={exampleTiles} />
		</a>
	{/each}
</div>

<style>
	.grids {
		display: flex;
		flex-wrap: wrap;
		column-gap: 20px;
		margin: auto;
		justify-content: center;
		color: var(--text-color);
		padding: 5px;
	}
	.grids a {
		display: block;
		padding: 5px;
		text-align: center;
	}
	.active {
		outline: 1px solid var(--accent-color);
	}
</style>
