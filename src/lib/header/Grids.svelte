<script>
	import { page } from '$app/stores';
	import { gridInfo } from '$lib/puzzle/grids/grids';
	let category = $derived($page.params.grid);
	let gridKind = $derived(category.split('-')[0]);
	let wrap = $derived(category.split('-')[1] === 'wrap');
	let info = $derived(gridInfo[gridKind]);
</script>

<div class="container">
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
	.grids a,
	.grids span {
		display: block;
		padding: 5px;
	}
	.active {
		outline: 1px solid var(--accent-color);
	}
</style>
