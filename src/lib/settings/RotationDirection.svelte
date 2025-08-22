<script>
	import { run } from 'svelte/legacy';

	import { settings } from '$lib/stores';
	/**
	 * @typedef {Object} Props
	 * @property {boolean} [clockwise]
	 * @property {boolean} [text]
	 */

	/** @type {Props} */
	let { clockwise = true, text = true } = $props();

	let actuallyClockwise = $state(clockwise);

	run(() => {
		actuallyClockwise = $settings.invertRotationDirection ? !clockwise : clockwise;
	});
</script>

{#if text}
	{#if actuallyClockwise}
		clockwise
	{:else}
		counter-clockwise
	{/if}
{:else if actuallyClockwise}
	↷
{:else}
	↶
{/if}
