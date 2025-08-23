<script>
	import Header from '$lib/header/Header.svelte';
	import Footer from '$lib/footer/Footer.svelte';
	import { dev } from '$app/environment';
	import { RenderScan } from 'svelte-render-scan';
	import './app.css';
	/**
	 * @typedef {Object} Props
	 * @property {import('svelte').Snippet} [children]
	 */

	/** @type {Props} */
	let { children } = $props();
</script>

<!-- {#if dev}
	<RenderScan />
{/if} -->

<div class="container">
	<Header />
</div>

<main>
	{@render children?.()}
</main>

<div class="container">
	<Footer />
</div>
