<script>
	import { page } from '$app/state';
	import PuzzleKindWrapper from '#lib/puzzleWrapper/PuzzleKindWrapper.svelte';
	import { asGridCategory } from '#lib/puzzle/grids/grids.js';
</script>

{#key page.url.pathname}
	<PuzzleKindWrapper
		width={Number(page.params.size)}
		height={Number(page.params.size)}
		category={asGridCategory(page.params.grid)}
		size={Number(page.params.size)}
		puzzleId={-1}
	/>
{/key}
