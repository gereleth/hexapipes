<script>
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

	let bgColor = '#aaa';
	let strokeColor = '#888';

	const myDirections = game.grid.getDirections($state.tile, 0, i);

	const [guideX, guideY] = game.grid.getGuideDotPosition($state.tile, i);

	const outlineWidth = game.grid.STROKE_WIDTH * 2 + game.grid.PIPE_WIDTH;
	const pipeWidth = game.grid.PIPE_WIDTH;

	let path = game.grid.getPipesPath($state.tile, i);
	const isSink = myDirections.length === 1;

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
	/**
	 * Choose tile stroke color
	 * @param {Boolean} hasDisconnects
	 * @param {Boolean} isPartOfIsland
	 */
	function chooseStrokeColor(hasDisconnects, isPartOfIsland) {
		if (isPartOfIsland) {
			strokeColor = '#b55';
		} else if (hasDisconnects) {
			strokeColor = '#666';
		} else {
			strokeColor = '#888';
		}
	}

	$: chooseBgColor($state.locked, $state.isPartOfLoop);
	$: chooseStrokeColor($state.hasDisconnects, $state.isPartOfIsland);
</script>

<g class="tile" transform="translate({cx},{cy})">
	<!-- Tile hexagon -->
	<path d={game.grid.getTilePath(i)} stroke="#aaa" stroke-width="0.02" fill={bgColor} />

	<!-- Pipe shape -->
	<g class="pipe" style="transform:rotate({game.grid.getAngle($state.rotations, i)}rad)">
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
				stroke-width={game.grid.STROKE_WIDTH}
				class="inside"
			/>
		{/if}
		<!-- Pipe inside -->
		<path
			class="inside"
			d={path}
			stroke={$state.color}
			stroke-width={pipeWidth}
			stroke-linejoin="round"
			stroke-linecap="round"
		/>
		{#if controlMode === 'orient_lock' && !$state.locked && !solved}
			<!-- Guide dot -->
			<circle cx={guideX} cy={-guideY} fill="orange" stroke="white" r="0.03" stroke-width="0.01" />
		{/if}
	</g>
	<!-- <text x="0" y="0" text-anchor="middle" font-size="0.2">{i}</text> -->
</g>

<style>
	.pipe {
		transition: transform 100ms;
	}
</style>
