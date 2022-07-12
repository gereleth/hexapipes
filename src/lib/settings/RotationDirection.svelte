<script>
	import { settings } from '$lib/stores';
	export let clockwise = true;
	export let text = true;

	let actuallyClockwise = clockwise;

	$: actuallyClockwise = $settings.invertRotationDirection ? !clockwise : clockwise;
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
