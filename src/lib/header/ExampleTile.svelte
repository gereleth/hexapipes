<script>
	/** @type {Number} i*/
	export let i;
	/** @type {Number} */
	export let tile;
	/** @type {import('$lib/puzzle/grids/grids').Grid} */
	export let grid;
	export let cx = 0;
	export let cy = 0;

	const bgColor = '#ddd';

	const outlineWidth = grid.STROKE_WIDTH * 2 + grid.PIPE_WIDTH;
	const pipeWidth = grid.PIPE_WIDTH;

	let path = grid.getPipesPath(tile, i);
	const isSink = grid.getDirections(tile, 0, i).length === 1;

	const tile_transform = grid.getTileTransformCSS(i) || '';
	const style = grid.polygon_at(i).style || undefined;
</script>

<g class="tile" transform="translate({cx},{cy})" {style}>
	<!-- Tile background -->
	<path
		d={grid.getTilePath(i)}
		stroke="#aaa"
		stroke-width="0.02"
		fill={bgColor}
		style="transform: {tile_transform}"
	/>

	<!-- Pipe shape -->
	<g class="pipe" style="transform: {tile_transform}">
		<!-- Pipe outline -->
		<path
			d={path}
			stroke="#888"
			stroke-width={outlineWidth}
			stroke-linejoin="bevel"
			stroke-linecap="round"
		/>
		<!-- Sink circle -->
		{#if isSink}
			<circle
				cx="0"
				cy="0"
				r={grid.SINK_RADIUS}
				fill="white"
				stroke="#888"
				stroke-width={grid.STROKE_WIDTH}
			/>
		{/if}
		<!-- Pipe inside -->
		<path
			class="inside"
			d={path}
			stroke="white"
			stroke-width={pipeWidth}
			stroke-linejoin={grid.lineJoin || 'round'}
			stroke-linecap="round"
		/>
	</g>
</g>

<style>
	.pipe {
		transition: transform 100ms;
	}
</style>
