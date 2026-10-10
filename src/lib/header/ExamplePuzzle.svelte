<script>
	import ExampleTile from '#lib/header/ExampleTile.svelte';

	/**
	 * @typedef {Object} Props
	 * @property {any} grid
	 * @property {Number[]} tiles
	 * @property {number} [svgWidth]
	 * @property {number} [svgHeight]
	 */

	/** @type {Props} */
	let { grid, tiles, svgWidth = 200, svgHeight = 200 } = $props();

	// the example is static, all props are constants
	// svelte-ignore state_referenced_locally
	const viewBox = $state({
		xmin: grid.XMIN,
		width: grid.XMAX - grid.XMIN,
		ymin: grid.YMIN,
		height: grid.YMAX - grid.YMIN
	});

	// svelte-ignore state_referenced_locally
	const wpx = svgWidth / viewBox.width;
	// svelte-ignore state_referenced_locally
	const hpx = svgHeight / viewBox.height;
	let pxPerCell = Math.min(wpx, hpx);
	// svelte-ignore state_referenced_locally
	viewBox.width = svgWidth / pxPerCell;
	// svelte-ignore state_referenced_locally
	viewBox.height = svgHeight / pxPerCell;
	// svelte-ignore state_referenced_locally
	if (viewBox.width > grid.XMAX - grid.XMIN) {
		viewBox.xmin = (grid.XMAX + grid.XMIN - viewBox.width) * 0.5;
	}
	// svelte-ignore state_referenced_locally
	if (viewBox.height > grid.YMAX - grid.YMIN) {
		viewBox.ymin = (grid.YMAX + grid.YMIN - viewBox.height) * 0.5;
	}

	// svelte-ignore state_referenced_locally
	const visibleTiles = grid.getVisibleTiles(viewBox);
</script>

<div class="puzzle">
	<svg
		width={svgWidth}
		height={svgHeight}
		viewBox="{viewBox.xmin} {viewBox.ymin} {viewBox.width} {viewBox.height}"
	>
		{#each visibleTiles as visibleTile, i (visibleTile.key)}
			<ExampleTile
				{grid}
				i={visibleTile.index}
				tile={tiles[visibleTile.index]}
				cx={visibleTile.x}
				cy={visibleTile.y}
			/>
		{/each}
	</svg>
</div>

<style>
	svg {
		display: block;
		margin: auto;
		border: 1px solid var(--secondary-color);
	}
</style>
