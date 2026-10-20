<script>
	/**
	 * @typedef {Object} Props
	 * @property {import('#lib/puzzle/game/game.svelte.js').PipesGame} game
	 * @property {Number} i
	 * @property {Number} [cx]
	 * @property {Number} [cy]
	 * @property {boolean} [solved]
	 * @property {import('#lib/stores.js').ControlMode} [controlMode]
	 */

	/** @type {Props} */
	let { i, game, cx = 0, cy = 0, solved = false, controlMode = 'rotate_lock' } = $props();

	// tile geometry is fixed per instance, game/i never change
	// svelte-ignore state_referenced_locally
	let data = game.tileStates[i];
	// svelte-ignore state_referenced_locally
	const polygon = game.grid.polygonAt(i);
	// svelte-ignore state_referenced_locally
	const guideDotRadius = game.grid.GUIDE_DOT_RADIUS;
	// svelte-ignore state_referenced_locally
	const pipeWidth = game.grid.PIPE_WIDTH * 0.7;

	// svelte-ignore state_referenced_locally
	const tile_transform = game.grid.getCellTransformCSS(i) || '';

	const paths = data.pipes.map((pipe) => polygon.getPipePath(-pipe));

	// svelte-ignore state_referenced_locally
	const [guideX, guideY] = game.grid.getGuideDotPosition(data.pipeUnion, i);

	// sinks mark deadend pipes
	const sinks = data.pipes.map((pipe, pipeIndex) => {
		if (game.grid.getDirections(pipe, 0, i).length === 1) {
			const { cx, cy } = polygon.getPipeCenter(pipe);
			return {
				pipeIndex,
				x: cx,
				y: -cy
			};
		} else {
			return null;
		}
	});
	// .filter((sink) => sink !== null);

	let bgColor = $derived.by(() => {
		if (data.isPartOfLoop.some((x) => x)) {
			return data.locked ? '#f99' : '#fbb';
		} else {
			return data.locked ? '#bbb' : '#ddd';
		}
	});

	let strokes = $derived.by(() => {
		return data.pipes.map((_, pipeIndex) => {
			if (data.hasDisconnects[pipeIndex]) {
				return {
					strokeColor: game.disconnectStrokeColor,
					strokeWidth: game.grid.STROKE_WIDTH * game.disconnectStrokeWidthScale
				};
			} else if (data.isPartOfIsland[pipeIndex]) {
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
		d={game.grid.getCellPath(i)}
		stroke="#aaa"
		stroke-width="0.02"
		fill={bgColor}
		style="transform: {tile_transform}"
	/>

	<!-- Pipes, rotated together -->
	<g
		class="pipe"
		style="transform: {tile_transform} rotate({game.grid.getAngle(data.rotations, i)}rad)"
	>
		{#each paths as path, pipeIndex (pipeIndex)}
			<!-- Pipe outlines -->
			<path
				d={path}
				stroke={strokes[pipeIndex].strokeColor}
				stroke-width={2 * strokes[pipeIndex].strokeWidth + pipeWidth}
				stroke-linejoin="bevel"
				stroke-linecap="round"
			/>
			<!-- Sink circles on deadend pipes -->
			{@const sink = sinks[pipeIndex]}
			{#if sink !== null}
				<circle
					cx={sink.x}
					cy={sink.y}
					r={game.grid.SINK_RADIUS * 0.7}
					fill={data.colors[sink.pipeIndex]}
					stroke={strokes[sink.pipeIndex].strokeColor}
					stroke-width={strokes[sink.pipeIndex].strokeWidth}
					class="sink"
				/>
			{/if}
			<!-- Pipe insides -->
			<path
				class="inside"
				d={path}
				stroke={data.colors[pipeIndex]}
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
