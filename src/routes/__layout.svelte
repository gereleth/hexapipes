<script>
	import Header from '$lib/header/Header.svelte';
	import styles from '../app.css';
</script>


<div class="container">

<Header />
	<main>
		<slot />
	</main>
</div>

<style>
    .container {
        margin: auto;
        max-width: 1000px;
    }
</style>