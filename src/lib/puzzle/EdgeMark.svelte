<script>
	import { fade } from 'svelte/transition';
	import { createEventDispatcher } from 'svelte';
	/** @type {import('$lib/puzzle/hexagrid').HexaGrid} */
	export let grid;
	export let state = 'none';
	export let direction = 1;

	const dispatch = createEventDispatcher();
	// offset from center of tile
	const [offsetX, offsetY] = grid.XY_DELTAS.get(direction);
	// drawn line deltas
	const [dx, dy] = grid.XY_DELTAS.get(grid.OPPOSITE.get(direction));

	const lineLength = 0.15;
</script>

{#if state !== 'none'}
	{#if state !== 'empty'}
		<line
			transition:fade|local={{ duration: 100 }}
			class="mark"
			class:wall={state === 'wall'}
			class:connection={state === 'connection'}
			x1={+0.5 * offsetX - dx * lineLength}
			y1={-0.5 * offsetY + dy * lineLength}
			x2={+0.5 * offsetX + dx * lineLength}
			y2={-0.5 * offsetY - dy * lineLength}
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
