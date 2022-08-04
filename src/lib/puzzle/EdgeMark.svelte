<script>
	import { fade } from 'svelte/transition';
	import { createEventDispatcher } from 'svelte';
    /** @type {import('$lib/puzzle/hexagrid').HexaGrid} */
	export let grid;
	// coordinates of tile center
	export let cx = 0;
	export let cy = 0;
	export let state = 'none';
	export let direction = 1;

	const dispatch = createEventDispatcher();
	// offset from center of tile
	const [offsetX, offsetY] = grid.XY_DELTAS.get(direction);
	// drawn line deltas
	const [dx, dy] = grid.XY_DELTAS.get(grid.OPPOSITE.get(direction));

	function toggleState() {
		if (state === 'empty') {
			state = 'wall';
		} else if (state === 'wall') {
			state = 'connection';
		} else {
			state = 'empty';
		}
		dispatch('save');
	}
	const lineLength = 0.15;
</script>

{#if state !== 'none'}
	{#if state !== 'empty'}
		<line
			transition:fade|local={{ duration: 100 }}
			class="mark"
			class:wall={state === 'wall'}
			class:connection={state === 'connection'}
			x1={cx + 0.5 * offsetX - dx * lineLength}
			y1={cy - 0.5 * offsetY + dy * lineLength}
			x2={cx + 0.5 * offsetX + dx * lineLength}
			y2={cy - 0.5 * offsetY - dy * lineLength}
			stroke="green"
			stroke-width="0.04"
		/>
	{/if}
	<!-- <circle
		class="clickarea"
		cx={cx + 0.5 * offsetX}
		cy={cy - 0.5 * offsetY}
		r={lineLength/2}
		on:click={toggleState}
		on:contextmenu={() => {
			toggleState(), toggleState();
		}}
	/> -->
{/if}

<style>
	.clickarea {
		fill: rgba(0, 0, 0, 0);
		cursor: pointer;
	}
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