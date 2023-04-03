<script>
	import { page } from '$app/stores';
	import Instructions from '$lib/Instructions.svelte';
	import { gridInfo } from '$lib/puzzle/grids/grids';

	let sizes = [5, 7, 10, 15, 20, 30, 40];

	$: category = $page.params.grid;
	$: gridKind = category.split('-')[0];
	$: wrap = category.split('-')[1] === 'wrap';
	$: info = gridInfo[gridKind];
	$: title = `${info.title} ` + (wrap ? ' Wrap' : '') + ' Pipes';
</script>

<svelte:head>
	<title>
		{$page.params.size}x{$page.params.size}
		{title} Puzzle
	</title>
</svelte:head>

<div class="container">
	<h1>{title}</h1>

	<div class="grids">
		<span>Grid:</span>
		<a href="/{gridKind}/5" class:active={!wrap}>
			{info.title}
		</a>
		{#if info.wrap}
			<a href="/{gridKind}-wrap/5" class:active={wrap}>
				{info.title} wrap
			</a>
		{/if}
		<a href="/play"> Other grids </a>
	</div>

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

<div class="info container">
	<h2>{$page.params.size}x{$page.params.size} {title} Puzzle</h2>

	<p>Rotate the tiles so that all pipes are connected with no loops.</p>
</div>

<slot />

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
