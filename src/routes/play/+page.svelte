<script>
	import GridsExamples from '$lib/header/GridsExamples.svelte';
</script>

<svelte:head>
	<title>Pipes Puzzles</title>
</svelte:head>

<div class="container play">
	<h1>Choose your grid</h1>
	<GridsExamples />
	<h2>Make a <a href="custom">custom puzzle</a></h2>
	<ul>
		<li>Experiment with generator settings</li>
		<li>Watch the solver work</li>
		<li>Explore multiple solutions</li>
	</ul>
</div>

<style>
	h2 {
		text-align: center;
	}
	ul {
		color: var(--text-color);
		margin: auto;
		width: fit-content;
	}
	.play {
		min-height: 70vh;
	}
</style>
