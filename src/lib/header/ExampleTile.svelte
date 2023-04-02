<script>
	/** @type {Number} i*/
	export let i;
	/** @type {Number} */
	export let tile;
	export let grid;
	export let cx = 0;
	export let cy = 0;

	const bgColor = '#ddd';

	const outlineWidth = grid.STROKE_WIDTH * 2 + grid.PIPE_WIDTH;
	const pipeWidth = grid.PIPE_WIDTH;

	let path = grid.getPipesPath(tile, i);
	const isSink = grid.getDirections(tile, 0, i).length === 1;
</script>

<g class="tile" transform="translate({cx},{cy})">
	<!-- Tile background -->
	<path d={grid.getTilePath(i)} stroke="#aaa" stroke-width="0.02" fill={bgColor} />

	<!-- Pipe shape -->
	<g class="pipe">
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
			stroke-linejoin="round"
			stroke-linecap="round"
		/>
	</g>
</g>

<style>
	.pipe {
		transition: transform 100ms;
	}
</style>
