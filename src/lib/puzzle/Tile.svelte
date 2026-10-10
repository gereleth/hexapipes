<script>
	/**
	 * @typedef {Object} Props
	 * @property {import('#lib/puzzle/game.svelte.js').PipesGame} game
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
	const guideDotRadius = game.grid.GUIDE_DOT_RADIUS;

	// svelte-ignore state_referenced_locally
	const myDirections = game.grid.getDirections(data.tile, 0, i);

	// svelte-ignore state_referenced_locally
	const [guideX, guideY] = game.grid.getGuideDotPosition(data.tile, i);

	// svelte-ignore state_referenced_locally
	const pipeWidth = game.grid.PIPE_WIDTH;

	// svelte-ignore state_referenced_locally
	let path = game.grid.getPipesPath(data.tile, i);
	// svelte-ignore state_referenced_locally
	const isSink = myDirections.length === 1;

	// svelte-ignore state_referenced_locally
	const tile_transform = game.grid.getTileTransformCSS(i) || '';

	let bgColor = $derived.by(() => {
		if (data.isPartOfLoop) {
			return data.locked ? '#f99' : '#fbb';
		} else {
			return data.locked ? '#bbb' : '#ddd';
		}
	});

	let { strokeColor, strokeWidth } = $derived.by(() => {
		if (data.hasDisconnects) {
			return {
				strokeColor: game.disconnectStrokeColor,
				strokeWidth: game.grid.STROKE_WIDTH * game.disconnectStrokeWidthScale
			};
		} else if (data.isPartOfIsland) {
			return {
				strokeColor: '#b55',
				strokeWidth: game.grid.STROKE_WIDTH
			};
		} else {
			return {
				strokeColor: '#888',
				strokeWidth: game.grid.STROKE_WIDTH
			};
		}
	});

	let outlineWidth = $derived(2 * strokeWidth + game.grid.PIPE_WIDTH);

	// svelte-ignore state_referenced_locally
	const style = game.grid.polygon_at(i).style || undefined;
</script>

<g class="tile" transform="translate({cx},{cy})" {style}>
	<!-- Tile hexagon -->
	<path
		d={game.grid.getTilePath(i)}
		stroke="#aaa"
		stroke-width="0.02"
		fill={bgColor}
		style="transform: {tile_transform}"
	/>

	<!-- Pipe shape -->
	<g
		class="pipe"
		style="transform: {tile_transform} rotate({game.grid.getAngle(data.rotations, i)}rad)"
	>
		<!-- Pipe outline -->
		<path
			d={path}
			stroke={strokeColor}
			stroke-width={outlineWidth}
			stroke-linejoin="bevel"
			stroke-linecap="round"
		/>
		<!-- Sink circle -->
		{#if isSink}
			<circle
				cx="0"
				cy="0"
				r={game.grid.SINK_RADIUS}
				fill={data.color}
				stroke={strokeColor}
				stroke-width={strokeWidth}
				class="sink"
			/>
		{/if}
		<!-- Pipe inside -->
		<path
			class="inside"
			d={path}
			stroke={data.color}
			stroke-width={pipeWidth}
			stroke-linejoin={game.grid.LINE_JOIN}
			stroke-linecap="round"
		/>
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
