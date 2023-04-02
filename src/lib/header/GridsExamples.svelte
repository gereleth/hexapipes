<script>
	import { page } from '$app/stores';
	import { HexaGrid } from '$lib/puzzle/grids/hexagrid';
	import { SquareGrid } from '$lib/puzzle/grids/squaregrid';
	import { OctaGrid } from '$lib/puzzle/grids/octagrid';
	import ExamplePuzzle from './ExamplePuzzle.svelte';

	const grids = [
		{
			url: 'hexagonal',
			title: 'Hexagonal',
			grid: new HexaGrid(3, 3, false),
			tiles: [32, 34, 32, 50, 56, 8, 12, 20, 16]
		},
		// {
		// 	url: 'hexagonal-wrap',
		// 	title: 'Hexagonal wrap',
		// 	grid: new HexaGrid(3, 3, true),
		// 	tiles: [20, 24, 5, 42, 4, 8, 12, 16, 48]
		// },
		{
			url: 'square',
			title: 'Square',
			grid: new SquareGrid(3, 3, false),
			tiles: [9, 13, 8, 10, 6, 12, 12, 4, 1]
		},
		// {
		// 	url: 'square-wrap',
		// 	title: 'Square wrap',
		// 	grid: new SquareGrid(3, 3, true),
		// 	tiles: [1, 4, 13, 8, 5, 3, 6, 5, 9]
		// },
		{
			url: 'octagonal',
			title: 'Octagonal',
			grid: new OctaGrid(3, 3, false),
			tiles: [32, 64, 192, 18, 68, 66, 5, 200, 128, 130, 168, 0, 40, 8, 0, 0, 0, 0]
		}
		// {
		// 	url: 'octagonal-wrap',
		// 	title: 'Octagonal wrap',
		// 	grid: new OctaGrid(3, 3, true),
		// 	tiles: [133, 5, 2, 76, 16, 81, 80, 84, 4, 32, 34, 168, 2, 2, 8, 10, 138, 2]
		// }
	];
</script>

<div class="grids">
	{#each grids as { url, title, grid, tiles }}
		<a href="/{url}/5" class:active={$page.url.pathname.startsWith(`/${url}/`)}>
			{title}
			<ExamplePuzzle {grid} {tiles} />
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
