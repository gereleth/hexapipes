<script>
	import EdgeMark from '$lib/puzzle/EdgeMark.svelte';
	import { tweened } from 'svelte/motion';
	import { cubicOut } from 'svelte/easing';

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

	let rotationAnimate = tweened($state.rotations, {
		duration: 75,
		easing: cubicOut
	});

	// disable edge marks on outer edges of non-wrap puzzles
	if (!game.grid.wrap) {
		game.grid.EDGEMARK_DIRECTIONS.forEach((direction, index) => {
			const { neighbour } = game.grid.find_neighbour(i, direction);
			if (neighbour === -1) {
				$state.edgeMarks[index] = 'none';
			}
		});
	}

	const myDirections = game.grid.getDirections($state.tile);

	const deltas = myDirections.map((direction) => game.grid.XY_DELTAS.get(direction));
	let angle = game.grid.getTileAngle($state.tile);

	let path = `M ${cx} ${cy}`;
	for (let [dx, dy] of deltas) {
		path += ` l ${0.5 * dx} ${-0.5 * dy} L ${cx} ${cy}`;
	}
	const isSink = myDirections.length === 1;

	const hexagon = `M ${cx} ${cy} ` + game.grid.tilePath;

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

	// want to animate even if rotation is from another wrap tile
	$: rotationAnimate.set($state.rotations);
</script>

<g class="tile" data-index={i} data-x={cx} data-y={cy}>
	<!-- Tile hexagon -->
	<path d={hexagon} stroke="#aaa" stroke-width="0.02" fill={bgColor} />

	<!-- Pipe shape -->
	<g transform="rotate({60 * $rotationAnimate}, {cx}, {cy})">
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
				{cx}
				{cy}
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
				cx={cx + 0.4 * Math.cos(angle)}
				cy={cy - 0.4 * Math.sin(angle)}
				fill="orange"
				stroke="white"
				r="0.03"
				stroke-width="0.01"
			/>
		{/if}
	</g>
	{#if !solved}
		{#each $state.edgeMarks as _, index (index)}
			<EdgeMark
				grid={game.grid}
				{cx}
				{cy}
				state={$state.edgeMarks[index]}
				direction={game.grid.EDGEMARK_DIRECTIONS[index]}
			/>
		{/each}
	{/if}
</g>

<style>
	.tile {
		transform-origin: center;
		transform-box: fill-box;
		transition: transform 100ms;
	}
</style>
