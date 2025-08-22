<script>
	import Settings from '$lib/settings/Settings.svelte';
	import { createEventDispatcher } from 'svelte';

	/**
	 * @typedef {Object} Props
	 * @property {boolean} [solved]
	 * @property {boolean} [includeNewPuzzleButton]
	 */

	/** @type {Props} */
	let { solved = false, includeNewPuzzleButton = true } = $props();

	const dispatch = createEventDispatcher();

	function startOver() {
		if (window.confirm('Erase your progress and start over?')) {
			dispatch('startOver');
		}
	}

	function newPuzzle() {
		if (solved || window.confirm('Skip this puzzle and start a new one?')) {
			dispatch('newPuzzle');
		}
	}
	let showSettings = $state(false);
</script>

<div class="buttons">
	<!-- Start over button-->
	<button onclick={startOver}> 🔁 Start over </button>
	<!-- Settings button -->
	<button onclick={() => (showSettings = !showSettings)}> ⚙️ Settings </button>
	<!-- New puzzle button -->
	{#if includeNewPuzzleButton}
		<button onclick={newPuzzle}> ➡️ New puzzle </button>
	{/if}
</div>
<div class="buttons secondary">
	<!-- Download button -->
	<button onclick={() => dispatch('download')}> ⬇️ Download this puzzle</button>
</div>

{#if showSettings}
	<Settings />
{/if}

<style>
	.buttons {
		display: flex;
		justify-content: center;
		column-gap: 1em;
		margin-bottom: 1em;
		flex-wrap: wrap;
		row-gap: 1em;
	}
	button {
		color: var(--text-color);
		display: block;
		min-height: 2em;
		cursor: pointer;
	}
	.secondary button {
		background: none;
		border: none;
		text-decoration: underline;
		color: #888;
	}
</style>
