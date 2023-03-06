<script>
	import EdgeMark from '$lib/puzzle/EdgeMark.svelte';

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

	// disable edge marks on outer edges of non-wrap puzzles
	if (!game.grid.wrap) {
		game.grid.EDGEMARK_DIRECTIONS.forEach((direction, index) => {
			const { neighbour, empty } = game.grid.find_neighbour(i, direction);
			if (empty) {
				$state.edgeMarks[index] = 'none';
			}
		});
	}

	const myDirections = game.grid.getDirections($state.tile);

	const deltas = myDirections.map((direction) => game.grid.XY_DELTAS.get(direction) || [0, 0]);
	let angle = game.grid.getTileAngle($state.tile);

	let path = `M 0 0`;
	for (let [dx, dy] of deltas) {
		path += ` l ${0.5 * dx} ${-0.5 * dy} L 0 0`;
	}
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

	$: chooseBgColor($state.locked, $state.isPartOfLoop);
</script>

<g class="tile" transform="translate({cx},{cy})">
	<!-- Tile hexagon -->
	<path d={game.grid.tilePath} stroke="#aaa" stroke-width="0.02" fill={bgColor} />

	<!-- Pipe shape -->
	<g class="pipe" style="transform:rotate({game.grid.ANGLE_DEG * $state.rotations}deg)">
		<!-- Pipe outline -->
		<path
			d={path}
			stroke="#888"
			stroke-width="0.20"
			stroke-linejoin="bevel"
			stroke-linecap="round"
		/>
		<!-- Sink circle -->
		{#if isSink}
			<circle
				cx="0"
				cy="0"
				r="0.15"
				fill={$state.color}
				stroke="#888"
				stroke-width="0.05"
				class="inside"
			/>
		{/if}
		<!-- Pipe inside -->
		<path
			class="inside"
			d={path}
			stroke={$state.color}
			stroke-width="0.10"
			stroke-linejoin="round"
			stroke-linecap="round"
		/>
		{#if controlMode === 'orient_lock' && !$state.locked && !solved}
			<!-- Guide dot -->
			<circle
				cx={0.4 * Math.cos(angle)}
				cy={-0.4 * Math.sin(angle)}
				fill="orange"
				stroke="white"
				r="0.03"
				stroke-width="0.01"
			/>
		{/if}
	</g>
	<!-- <text x="0" y="0" text-anchor="middle" font-size="0.2">{i}</text> -->
	{#if !solved}
		{#each $state.edgeMarks as _, index (index)}
			<EdgeMark
				grid={game.grid}
				state={$state.edgeMarks[index]}
				direction={game.grid.EDGEMARK_DIRECTIONS[index]}
			/>
		{/each}
	{/if}
</g>

<style>
	.pipe {
		transition: transform 100ms;
	}
</style>
