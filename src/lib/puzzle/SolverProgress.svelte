<script>
	/** @type {import('$lib/puzzle/solver').SolverProgress} */
	export let progress;

	$: scale = 100 / progress.total;
	$: ws = scale * progress.solved;
	$: wg = scale * progress.guessed;
	$: wa = scale * progress.ambiguous;
	$: wu = scale * (progress.total - progress.solved - progress.guessed - progress.ambiguous);
</script>

<div class="solver-progress">
	<div class="solved" style="width: {ws}%" title="Number of solved tiles" />
	<div class="guessed" style="width: {wg}%" title="Number of guesses" />
	<div class="unsolved" style="width: {wu}%" title="Number of unsolved tiles" />
	<div class="ambiguous" style="width: {wa}%" title="Number of ambiguous tiles" />
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
