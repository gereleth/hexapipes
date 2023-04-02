<script>
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';

	onMount(async () => {
		await goto(`/${$page.params.grid}/5`, { replaceState: true });
	});
</script>

<div class="container">
	<p>This should redirect to a random puzzle page soon.</p>
</div>

<style>
	p {
		text-align: center;
	}
</style>
