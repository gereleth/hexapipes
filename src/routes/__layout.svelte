<script>
	import Header from '$lib/header/Header.svelte';
	import Footer from '$lib/footer/Footer.svelte';
	import styles from '../app.css';
</script>


<div class="container">
	<Header />
</div>

<main>
	<slot />
</main>