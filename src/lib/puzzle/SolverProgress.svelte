<script>
	
	/**
	 * @typedef {Object} Props
	 * @property {import('$lib/puzzle/solver').SolverProgress} progress
	 */

	/** @type {Props} */
	let { progress } = $props();

	let scale = $derived(100 / progress.total);
	let ws = $derived(scale * progress.solved);
	let wg = $derived(scale * progress.guessed);
	let wa = $derived(scale * progress.ambiguous);
	let wu = $derived(scale * (progress.total - progress.solved - progress.guessed - progress.ambiguous));
</script>

<div class="solver-progress">
	<div class="solved" style="width: {ws}%" title="Number of solved tiles"></div>
	<div class="guessed" style="width: {wg}%" title="Number of guesses"></div>
	<div class="unsolved" style="width: {wu}%" title="Number of unsolved tiles"></div>
	<div class="ambiguous" style="width: {wa}%" title="Number of ambiguous tiles"></div>
</div>

<style>
	.solver-progress {
		display: flex;
		flex-direction: row;
		height: 0.5em;
	}
	.solver-progress div {
		height: 100%;
	}
	.solved {
		background-color: #afa;
	}
	.guessed {
		background-color: #adf;
	}
	.unsolved {
		background-color: #ccc;
	}
	.ambiguous {
		background-color: #faa;
	}
</style>
