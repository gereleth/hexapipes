<script>
	import { gridInfo } from './grids/grids';

	/** @type {Number} i*/
	export let i;

	/**
	 * @type {import('$lib/puzzle/game').PipesGame} game
	 */
	export let game;
	export let cx = 0;
	export let cy = 0;
	export let solved = false;
	export let controlMode = 'rotate_lock';

	let state = game.tileStates[i];
	const disconnectStrokeWidthScale = game.disconnectStrokeWidthScale;
	const disconnectStrokeColor = game.disconnectStrokeColor;
	const guideDotRadius = game.grid.GUIDE_DOT_RADIUS;

	let bgColor = '#aaa';
	let strokeColor = '#888';
	let strokeWidth = game.grid.STROKE_WIDTH;
	let outlineWidth = 2 * strokeWidth + game.grid.PIPE_WIDTH;

	const myDirections = game.grid.getDirections($state.tile, 0, i);

	const [guideX, guideY] = game.grid.getGuideDotPosition($state.tile, i);

	const pipeWidth = game.grid.PIPE_WIDTH;

	let path = game.grid.getPipesPath($state.tile, i);
	const isSink = myDirections.length === 1;

	const tile_transform = game.grid.getTileTransformCSS(i) || '';
	/**
	 * Choose tile background color
	 * @param {Boolean} locked
	 * @param {Boolean} isPartOfLoop
	 */
	function chooseBgColor(locked, isPartOfLoop) {
		if (isPartOfLoop) {
			bgColor = locked ? '#f99' : '#fbb';
		} else {
			bgColor = locked ? '#bbb' : '#ddd';
		}
	}

	$: if ($state.hasDisconnects) {
		strokeColor = $disconnectStrokeColor;
		strokeWidth = game.grid.STROKE_WIDTH * $disconnectStrokeWidthScale;
	} else if ($state.isPartOfIsland) {
		strokeColor = '#b55';
		strokeWidth = game.grid.STROKE_WIDTH;
	} else {
		strokeColor = '#888';
		strokeWidth = game.grid.STROKE_WIDTH;
	}
	$: chooseBgColor($state.locked, $state.isPartOfLoop);
	$: outlineWidth = 2 * strokeWidth + game.grid.PIPE_WIDTH;
	$: style = game.grid.polygon_at(i).style || undefined;
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
		style="transform: {tile_transform} rotate({game.grid.getAngle($state.rotations, i)}rad)"
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
				fill={$state.color}
				stroke={strokeColor}
				stroke-width={strokeWidth}
				class="sink"
			/>
		{/if}
		<!-- Pipe inside -->
		<path
			class="inside"
			d={path}
			stroke={$state.color}
			stroke-width={pipeWidth}
			stroke-linejoin={game.grid.LINE_JOIN}
			stroke-linecap="round"
		/>
		{#if controlMode === 'orient_lock' && !$state.locked && !solved}
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
