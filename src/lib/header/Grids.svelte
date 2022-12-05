<script>
	import { page } from '$app/stores';
</script>

<div class="container">
	<div class="grids">
		<span>Grid:</span>
		<a href="/hexagonal/5" class:active={$page.url.pathname.startsWith(`/hexagonal/`)}>
			Hexagonal
		</a>
		<a href="/hexagonal-wrap/5" class:active={$page.url.pathname.startsWith(`/hexagonal-wrap/`)}>
			Hexagonal wrap
		</a>
		<a href="/custom" class:active={$page.url.pathname.startsWith(`/custom`)}> Custom </a>
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
