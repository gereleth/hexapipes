<script>
	import { fade } from 'svelte/transition';

	/** @typedef {Object} Props
	 * @property {number} i - tile index
	 * @property {import('#lib/puzzle/game.svelte.js').PipesGame} game
	 * @property {number} [cx]
	 * @property {number} [cy]
	 */
	/**@type {Props}*/
	let { i, game, cx = 0, cy = 0 } = $props();

	/** @typedef {Object} VisibleMark
	 * @property {Number} x1
	 * @property {Number} x2
	 * @property {Number} y1
	 * @property {Number} y2
	 * @property {import('#lib/puzzle/game.svelte.js').EdgeMark} edgemark
	 * @property {Number} direction
	 */

	/** @typedef {Object} ReflectedMark -
	 * @property {Number} cx
	 * @property {Number} cy
	 * @property {String} transform
	 * @property {VisibleMark} mark
	 */

	// tile geometry is fixed per instance, game/i never change
	// svelte-ignore state_referenced_locally
	const tileState = game.tileStates[i];
	// svelte-ignore state_referenced_locally
	const tile_transform = game.grid.getTileTransformCSS(i) || '';

	// /** @type {VisibleMark[]} */
	// let visibleEdgeMarks = [];

	// /** @type {ReflectedMark[]} */
	// let reflectedEdgeMarks = [];

	// svelte-ignore state_referenced_locally
	const width = game.grid.EDGEMARK_WIDTH;

	let { visibleEdgeMarks, reflectedEdgeMarks } = $derived.by(() => {
		/**@type {VisibleMark[]}*/
		const visibleEdgeMarks = [];
		/** @type {ReflectedMark[]} */
		const reflectedEdgeMarks = [];
		tileState.edgeMarks.forEach((edgemark, index) => {
			if (edgemark === 'none' || edgemark === 'empty') {
				return;
			}
			const direction = game.grid.EDGEMARK_DIRECTIONS[index];
			const edgeMarkLine = game.grid.getEdgemarkLine(direction, edgemark === 'wall', i);
			const { x1, y1, x2, y2 } = edgeMarkLine;
			const mark = { x1, y1, x2, y2, edgemark, direction };
			visibleEdgeMarks.push(mark);
			if (game.grid.BEND_EDGEMARKS && edgemark === 'conn') {
				const { neighbour } = game.grid.find_neighbour(i, direction);
				const oppositeDirection = game.grid.OPPOSITE.get(direction) || 0;
				const { x1, y1, x2, y2, grid_x2, grid_y2 } = game.grid.getEdgemarkLine(
					oppositeDirection,
					false,
					neighbour
				);
				const oppositeMark = {
					cx: cx + (edgeMarkLine.grid_x2 - grid_x2),
					cy: cy + (edgeMarkLine.grid_y2 - grid_y2),
					transform: game.grid.getTileTransformCSS(neighbour) || '',
					mark: { x1, x2, y1, y2, edgemark, direction: oppositeDirection }
				};
				reflectedEdgeMarks.push(oppositeMark);
			}
		});
		return { visibleEdgeMarks, reflectedEdgeMarks };
	});
</script>

<g class="edgemarks" style="transform: translate({cx}px,{cy}px) {tile_transform}">
	{#each visibleEdgeMarks as { x1, y1, x2, y2, edgemark, direction } (direction)}
		<line
			transition:fade={{ duration: 100 }}
			class="mark"
			class:wall={edgemark === 'wall'}
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
			transition:fade={{ duration: 100 }}
			class="mark"
			class:wall={mark.edgemark === 'wall'}
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
