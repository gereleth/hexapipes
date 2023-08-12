<script>
	import ExampleTile from '$lib/header/ExampleTile.svelte';
	import ClipPolygon from '$lib/puzzle/ClipPolygon.svelte';

	export let grid;
	/** @type {Number[]} */
	export let tiles;
	export let svgWidth = 200;
	export let svgHeight = 200;

	const viewBox = {
		xmin: grid.XMIN,
		width: grid.XMAX - grid.XMIN,
		ymin: grid.YMIN,
		height: grid.YMAX - grid.YMIN
	};

	const wpx = svgWidth / viewBox.width;
	const hpx = svgHeight / viewBox.height;
	let pxPerCell = Math.min(wpx, hpx);
	viewBox.width = svgWidth / pxPerCell;
	viewBox.height = svgHeight / pxPerCell;
	if (viewBox.width > grid.XMAX - grid.XMIN) {
		viewBox.xmin = (grid.XMAX + grid.XMIN - viewBox.width) * 0.5;
	}
	if (viewBox.height > grid.YMAX - grid.YMIN) {
		viewBox.ymin = (grid.YMAX + grid.YMIN - viewBox.height) * 0.5;
	}

	const visibleTiles = grid.getVisibleTiles(viewBox);
</script>

<div class="puzzle">
	<svg
		width={svgWidth}
		height={svgHeight}
		viewBox="{viewBox.xmin} {viewBox.ymin} {viewBox.width} {viewBox.height}"
	>
		<defs>
			{#each Array(grid.total) as _, index (index)}
				<ClipPolygon
					i={index}
					id={[grid.KIND,'clip','path',index].join('-')}
					grid={grid}
				/>
			{/each}
		</defs>
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
