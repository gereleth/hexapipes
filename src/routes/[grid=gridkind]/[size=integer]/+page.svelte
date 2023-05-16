<script>
	import { page } from '$app/stores';
	import PuzzleKindWrapper from '$lib/puzzleWrapper/PuzzleKindWrapper.svelte';
</script>

{#key $page.url.pathname}
	<PuzzleKindWrapper
		width={Number($page.params.size)}
		height={Number($page.params.size)}
		category={$page.params.grid}
		size={Number($page.params.size)}
		puzzleId={-1}
	/>
{/key}
