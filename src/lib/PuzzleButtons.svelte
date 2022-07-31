<script>
	import { settings } from '$lib/stores';
	import {createEventDispatcher} from 'svelte';

	export let solved = false

	const dispatch = createEventDispatcher()

	function startOver() {
		if (window.confirm(
			'Erase your progress and start over?'
			)) {
			dispatch('startOver')
		}
	}

	function newPuzzle() {
		if (solved || window.confirm(
			'Skip this puzzle and start a new one?'
		)) {
			dispatch('newPuzzle')
		}
	}
</script>

<div class="buttons">
	<!-- Start over button-->
	<button on:click={startOver}>
		🔁 Start over
	</button>
	<!-- Hide/Show timer button -->
	<button on:click={()=> $settings.showTimer = !$settings.showTimer}>
		🕑 
		{#if $settings.showTimer}
			Hide timer
		{:else}
			Show timer
		{/if}
	</button>
	<!-- New puzzle button -->
	<button on:click={newPuzzle}>
		➡️ New puzzle
	</button>
</div>

<style>
	.buttons {
		display:flex;
		justify-content: center;
		column-gap: 1em;
		margin-bottom: 1em;
	}
    button {
        color: var(--text-color);
        display: block;
    }
</style>
