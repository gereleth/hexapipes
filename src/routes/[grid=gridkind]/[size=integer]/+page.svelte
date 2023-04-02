<script>
	import { page } from '$app/stores';
	import PuzzleWrapper from '$lib/puzzleWrapper/PuzzleWrapper.svelte';
</script>

<PuzzleWrapper
	width={Number($page.params.size)}
	height={Number($page.params.size)}
	tiles={[]}
	category={$page.params.grid}
	size={Number($page.params.size)}
	puzzleId={-1}
/>
