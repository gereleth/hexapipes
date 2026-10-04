<script>
	import { page } from '$app/state';
	import Instructions from '#lib/Instructions.svelte';
	import { gridInfo } from '#lib/puzzle/grids/grids.js';
	/**
	 * @typedef {Object} Props
	 * @property {import('svelte').Snippet} [children]
	 */

	/** @type {Props} */
	let { children } = $props();

	let category = $derived(page.params.grid);
	let gridKind = $derived(category.split('-')[0]);
	let wrap = $derived(category.split('-')[1] === 'wrap');
	let info = $derived(gridInfo[gridKind]);
	let title = $derived(`${info.title} ` + (wrap ? ' Wrap' : '') + ' Pipes');
	let sizes = $derived(info.sizes);
</script>

<svelte:head>
	<title>
		{page.params.size}x{page.params.size}
		{title} Puzzle
	</title>
</svelte:head>

<div class="container">
	<h1>{title}</h1>

	<div class="grids">
		<span>Grid:</span>
		<a href="/{gridKind}/{sizes[0]}" class:active={!wrap}>
			{info.title}
		</a>
		{#if info.wrap}
			<a href="/{gridKind}-wrap/{sizes[0]}" class:active={wrap}>
				{info.title} wrap
			</a>
		{/if}
		<a href="/play"> Other grids </a>
	</div>

	<div class="sizes">
		<span> Size:</span>
		{#each sizes as size}
			<a
				href="/{page.params.grid}/{size}"
				class:active={page.url.pathname.includes(`/${page.params.grid}/${size}`)}
			>
				{size}x{size}
			</a>
		{/each}
	</div>
</div>

<div class="info container">
	<h2>{page.params.size}x{page.params.size} {title} Puzzle</h2>

	<p>Rotate the tiles so that all pipes are connected with no loops.</p>
</div>

{@render children?.()}

<Instructions />

<style>
	.sizes,
	.grids {
		display: flex;
		flex-wrap: wrap;
		column-gap: 20px;
		margin: auto;
		justify-content: center;
		color: var(--text-color);
	}
	.grids a,
	.grids span,
	.sizes a,
	.sizes span {
		display: block;
		padding: 5px;
	}
	.active {
		outline: 1px solid var(--accent-color);
	}

	p {
		text-align: center;
	}
	.info {
		text-align: center;
	}
</style>
