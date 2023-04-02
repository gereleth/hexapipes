<script>
	import { page } from '$app/stores';
	import Grids from '$lib/header/Grids.svelte';
	import Instructions from '$lib/Instructions.svelte';

	let sizes = [5, 7, 10, 15, 20, 30, 40];
	let title = '';

	$: if ($page.params.grid.startsWith('hexagonal')) {
		title = 'Hexagonal Pipes';
	} else if ($page.params.grid.startsWith('square')) {
		title = 'Square Pipes';
	} else if ($page.params.grid.startsWith('octagonal')) {
		title = 'Octagonal Pipes';
	}
</script>

<div class="container">
	<h1>{title}</h1>
	<Grids />
	<div class="sizes">
		<span> Size:</span>
		{#each sizes as size}
			<a
				href="/{$page.params.grid}/{size}"
				class:active={$page.url.pathname.includes(`/${$page.params.grid}/${size}`)}
			>
				{size}x{size}
			</a>
		{/each}
	</div>
</div>
<slot />

<Instructions />

<style>
	.sizes {
		display: flex;
		flex-wrap: wrap;
		column-gap: 20px;
		margin: auto;
		justify-content: center;
		color: var(--text-color);
	}
	.sizes a,
	.sizes span {
		display: block;
		padding: 5px;
	}
	.active {
		outline: 1px solid var(--accent-color);
	}
</style>
