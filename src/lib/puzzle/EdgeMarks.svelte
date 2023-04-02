<script>
	import { fade } from 'svelte/transition';

	/** @type {Number} i*/
	export let i;
	/**
	 * @type {import('$lib/puzzle/game').PipesGame} game
	 */
	export let game;
	export let cx = 0;
	export let cy = 0;

	let state = game.tileStates[i];

	/**
	 *
	 * @param {import('$lib/puzzle/game').EdgeMark[]} marks
	 */
	function visibleMarks(marks) {
		/**
		 * @type {{x1:number, x2: number, y1: number, y2:number, state: import('$lib/puzzle/game').EdgeMark, direction:number}[]}
		 */
		const visible = [];
		marks.forEach((state, index) => {
			if (state === 'none' || state === 'empty') {
				return;
			}
			const direction = game.grid.EDGEMARK_DIRECTIONS[index];
			const { x1, y1, x2, y2 } = game.grid.getEdgemarkLine(direction, i);
			visible.push({
				x1,
				y1,
				x2,
				y2,
				state,
				direction
			});
		});
		return visible;
	}

	$: visibleEdgeMarks = visibleMarks($state.edgeMarks);
</script>

<g class="edgemarks" transform="translate({cx},{cy})">
	{#each visibleEdgeMarks as { x1, y1, x2, y2, state, direction } (direction)}
		<line
			transition:fade|local={{ duration: 100 }}
			class="mark"
			class:wall={state === 'wall'}
			{x1}
			{y1}
			{x2}
			{y2}
			stroke="green"
			stroke-width="0.04"
		/>
	{/each}
</g>

<style>
	.mark {
		transform-origin: center;
		transform-box: fill-box;
		transition: transform 100ms;
	}
	.wall {
		stroke: #ff3e00;
		transform: rotate(90deg);
	}
</style>
