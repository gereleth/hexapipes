<script>
	/**
	 * @typedef {Object} Props
	 * @property {import('#lib/puzzle/game-layers.svelte.js').LayeredPipesGame} game
	 * @property {Number} i
	 * @property {Number} [cx]
	 * @property {Number} [cy]
	 * @property {boolean} [solved]
	 * @property {import('#lib/stores.js').ControlMode} [controlMode]
	 */

	/** @type {Props} */
	let { i, game, cx = 0, cy = 0, solved = false, controlMode = 'rotate_lock' } = $props();

	let data = game.tileStates[i];
	const polygon = game.grid.polygon_at(i);
	const guideDotRadius = game.grid.GUIDE_DOT_RADIUS;
	const pipeWidth = game.grid.PIPE_WIDTH * 0.7;

	const tile_transform = game.grid.getTileTransformCSS(i) || '';

	const paths = data.layers.map((layer) => polygon.get_pipes_path(-layer));

	const [guideX, guideY] = game.grid.getGuideDotPosition(data.tile, i);

	// sinks mark deadend layers, drawn on the pipe stub away from the center
	const sinks = data.layers.map((layer, layerIndex) => {
		if (game.grid.getDirections(layer, 0, i).length === 1) {
			const { cx, cy } = polygon.get_layer_center(layer);
			return {
				layerIndex,
				x: cx,
				y: -cy
			};
		} else {
			return null;
		}
	});
	// .filter((sink) => sink !== null);

	let bgColor = $derived.by(() => {
		if (game.cellIsPartOfLoop(i)) {
			return data.locked ? '#f99' : '#fbb';
		} else {
			return data.locked ? '#bbb' : '#ddd';
		}
	});

	let strokes = $derived.by(() => {
		return data.layers.map((layer, layerIndex) => {
			if (data.hasDisconnects[layerIndex]) {
				return {
					strokeColor: game.disconnectStrokeColor,
					strokeWidth: game.grid.STROKE_WIDTH * game.disconnectStrokeWidthScale
				};
			} else if (data.isPartOfIsland[layerIndex]) {
				return { strokeColor: '#b55', strokeWidth: game.grid.STROKE_WIDTH };
			} else {
				return { strokeColor: '#888', strokeWidth: game.grid.STROKE_WIDTH };
			}
		});
	});

	const style = polygon.style || undefined;
</script>

<g class="tile" transform="translate({cx},{cy})" {style}>
	<!-- Tile polygon -->
	<path
		d={game.grid.getTilePath(i)}
		stroke="#aaa"
		stroke-width="0.02"
		fill={bgColor}
		style="transform: {tile_transform}"
	/>

	<!-- Pipe layers, rotated together -->
	<g
		class="pipe"
		style="transform: {tile_transform} rotate({game.grid.getAngle(data.rotations, i)}rad)"
	>
		{#each paths as path, layerIndex (layerIndex)}
			<!-- Pipe outlines -->
			<path
				d={path}
				stroke={strokes[layerIndex].strokeColor}
				stroke-width={2 * strokes[layerIndex].strokeWidth + pipeWidth}
				stroke-linejoin="bevel"
				stroke-linecap="round"
			/>
			<!-- Sink circles on deadend layers -->
			{@const sink = sinks[layerIndex]}
			{#if sink !== null}
				<circle
					cx={sink.x}
					cy={sink.y}
					r={game.grid.SINK_RADIUS * 0.7}
					fill={data.colors[sink.layerIndex]}
					stroke={strokes[sink.layerIndex].strokeColor}
					stroke-width={strokes[sink.layerIndex].strokeWidth}
					class="sink"
				/>
			{/if}
			<!-- Pipe insides -->
			<path
				class="inside"
				d={path}
				stroke={data.colors[layerIndex]}
				stroke-width={pipeWidth}
				stroke-linejoin={game.grid.LINE_JOIN}
				stroke-linecap="round"
			/>
		{/each}
		{#if controlMode === 'orient_lock' && !data.locked && !solved}
			<!-- Guide dot -->
			<circle
				cx={guideX}
				cy={-guideY}
				fill="orange"
				stroke="white"
				r={guideDotRadius}
				stroke-width="0.01"
			/>
		{/if}
	</g>
	<!-- <text x="0" y="0" text-anchor="middle" font-size="0.2">{i}</text> -->
</g>

<style>
	.pipe path {
		fill: none;
	}
	:global(.animation-normal) .pipe {
		transition: transform 100ms ease;
	}
	:global(.animation-fast) .pipe {
		transition: transform 30ms ease;
	}
	:global(.animation-instant) .pipe {
		transition: transform 0ms;
	}
</style>
