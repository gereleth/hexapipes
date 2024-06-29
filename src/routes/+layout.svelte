<script>
	import Header from '$lib/header/Header.svelte';
	import Footer from '$lib/footer/Footer.svelte';
	import './app.css';
</script>

<div class="container">
	<Header />
</div>

<main>
	<slot />
</main>

<div class="container">
	<Footer />
</div>
