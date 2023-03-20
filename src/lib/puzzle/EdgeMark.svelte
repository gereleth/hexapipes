<script>
	import { fade } from 'svelte/transition';
	/** @type {import('$lib/puzzle/grids/hexagrid').HexaGrid} */
	export let grid;
	export let index;
	export let state = 'none';
	export let direction = 1;

	// offset from center of tile
	const { x1, y1, x2, y2 } = grid.getEdgemarkLine(direction, index);
	const lineLength = 0.15;
</script>

{#if state !== 'none'}
	{#if state !== 'empty'}
		<line
			transition:fade|local={{ duration: 100 }}
			class="mark"
			class:wall={state === 'wall'}
			class:connection={state === 'connection'}
			{x1}
			{y1}
			{x2}
			{y2}
			stroke="green"
			stroke-width="0.04"
		/>
	{/if}
{/if}

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
	.connection {
		stroke: #00b82d;
	}
</style>
