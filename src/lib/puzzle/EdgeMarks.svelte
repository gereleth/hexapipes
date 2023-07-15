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

	/** @typedef {Object} VisibleMark
	 * @property {Number} x1
	 * @property {Number} x2
	 * @property {Number} y1
	 * @property {Number} y2
	 * @property {import('$lib/puzzle/game').EdgeMark} state
	 * @property {Number} direction
	 */

	/** @typedef {Object} ReflectedMark -
	 * @property {Number} cx
	 * @property {Number} cy
	 * @property {String} transform
	 * @property {VisibleMark} mark
	 */

	const state = game.tileStates[i];
	const tile_transform = game.grid.getTileTransformCSS(i) || '';

	/** @type {VisibleMark[]} */
	let visibleEdgeMarks = [];

	/** @type {ReflectedMark[]} */
	let reflectedEdgeMarks = [];

	const width = game.grid.EDGEMARK_WIDTH;

	/**
	 * Collect edgemarks that should be displayed
	 * @param {import('$lib/puzzle/game').EdgeMark[]} marks
	 */
	function visibleMarks(marks) {
		visibleEdgeMarks = [];
		reflectedEdgeMarks = [];
		marks.forEach((state, index) => {
			if (state === 'none' || state === 'empty') {
				return;
			}
			const direction = game.grid.EDGEMARK_DIRECTIONS[index];
			const edgeMarkLine = game.grid.getEdgemarkLine(direction, state === 'wall', i);
			const { x1, y1, x2, y2 } = edgeMarkLine;
			const mark = { x1, y1, x2, y2, state, direction };
			visibleEdgeMarks.push(mark);
			if (game.grid.BEND_EDGEMARKS && state === 'conn') {
				const { neighbour, oppositeDirection } = game.grid.find_neighbour(i, direction);
				const { x1, y1, x2, y2, grid_x2, grid_y2 } = game.grid.getEdgemarkLine(
					oppositeDirection,
					false,
					neighbour
				);
				const oppositeMark = {
					cx: cx + (edgeMarkLine.grid_x2 - grid_x2),
					cy: cy + (edgeMarkLine.grid_y2 - grid_y2),
					transform: game.grid.getTileTransformCSS(neighbour) || '',
					mark: { x1, x2, y1, y2, state, direction: oppositeDirection }
				};
				reflectedEdgeMarks.push(oppositeMark);
			}
		});
	}

	$: visibleMarks($state.edgeMarks);
</script>

<g class="edgemarks" style="transform: translate({cx}px,{cy}px) {tile_transform}">
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
			stroke-width={width}
		/>
	{/each}
</g>

{#each reflectedEdgeMarks as { cx, cy, mark, transform } (mark.direction)}
	<g class="edgemarks" style="transform: translate({cx}px,{cy}px) {transform}">
		<line
			transition:fade|local={{ duration: 100 }}
			class="mark"
			class:wall={mark.state === 'wall'}
			x1={mark.x1}
			y1={mark.y1}
			x2={mark.x2}
			y2={mark.y2}
			stroke="green"
			stroke-width={width}
		/>
	</g>
{/each}

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
