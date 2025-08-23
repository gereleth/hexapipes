<script>
	import Settings from '$lib/settings/Settings.svelte';

	/**
	 * @typedef {Object} Props
	 * @property {boolean} [solved]
	 * @property {boolean} [includeNewPuzzleButton]
	 * @property {()=>void} [startOver]
	 * @property {()=>void} [newPuzzle]
	 * @property {()=>void} [download]
	 */

	/** @type {Props} */
	let {
		solved = false,
		includeNewPuzzleButton = true,
		startOver = () => {},
		newPuzzle = () => {},
		download = () => {}
	} = $props();

	function confirmAndStartOver() {
		if (window.confirm('Erase your progress and start over?')) {
			startOver();
		}
	}

	function confirmAndNewPuzzle() {
		if (solved || window.confirm('Skip this puzzle and start a new one?')) {
			newPuzzle();
		}
	}
	let showSettings = $state(false);
</script>

<div class="buttons">
	<!-- Start over button-->
	<button onclick={confirmAndStartOver}> 🔁 Start over </button>
	<!-- Settings button -->
	<button onclick={() => (showSettings = !showSettings)}> ⚙️ Settings </button>
	<!-- New puzzle button -->
	{#if includeNewPuzzleButton}
		<button onclick={confirmAndNewPuzzle}> ➡️ New puzzle </button>
	{/if}
</div>
<div class="buttons secondary">
	<!-- Download button -->
	<button onclick={download}> ⬇️ Download this puzzle</button>
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
