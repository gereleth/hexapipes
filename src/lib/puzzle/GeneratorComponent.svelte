<script>
	import { onDestroy } from 'svelte';
	import { slide } from 'svelte/transition';
	import Worker from '#lib/puzzle/worker.js?worker';
	import SolverProgress from '#lib/puzzle/SolverProgress.svelte';

	// callbacks for different generation outcomes
	let { canceled, generated, errored } = $props();

	/** @type {ReturnType<typeof setTimeout>} */
	let timer;
	/** @type {Worker|null} */
	let worker = null;
	let showGenProgress = $state(false);
	const dummyProgress = { total: 1, solved: 0, guessed: 0, ambiguous: 0 };
	/** @type {import('#lib/puzzle/solver.js').SolverProgress[]}*/
	let solverProgressItems = $state([]);

	/**
	 *
	 * @param {import('#lib/puzzle/generator.js').GeneratorOptions} options
	 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
	 */
	export function generate(options, grid) {
		worker = new Worker();
		worker.onmessage = onWorkerMessage;
		worker.postMessage({
			command: 'generate',
			grid: grid.export(),
			options
		});
		timer = setTimeout(() => {
			showGenProgress = true;
		}, 1000);
		solverProgressItems = [];
	}

	export function cancel() {
		worker?.terminate();
		showGenProgress = false;
		canceled();
	}

	/**
	 *
	 * @param {MessageEvent<any>} event
	 */
	function onWorkerMessage(event) {
		if (event.data.msg === 'generated') {
			generated({ tiles: event.data.tiles });
			showGenProgress = false;
			clearTimeout(timer);
		} else if (event.data.msg === 'error') {
			errored(event.data.error);
			showGenProgress = false;
			clearTimeout(timer);
		} else if (event.data.msg === 'generator_progress') {
			solverProgressItems.unshift(dummyProgress);
		} else if (event.data.msg === 'solver_progress') {
			solverProgressItems[0] = event.data.progress;
		}
	}

	onDestroy(() => {
		worker?.terminate();
	});
</script>

{#if showGenProgress}
	<div class="progress" transition:slide>
		<div
			class="generator-progress"
			style="background: linear-gradient(0deg, 
			rgba(170,255,170,1) 0%, 
			rgba(255,255,255,0) 100%);"
		>
			Generating a puzzle... <button onclick={cancel}>Cancel</button>
		</div>
		{#each solverProgressItems as solverProgress, i (solverProgressItems.length - i)}
			<SolverProgress progress={solverProgress} />
		{/each}
	</div>
{/if}

<style>
	.progress {
		width: 80%;
		margin: auto;
		min-height: 7em;
		text-align: center;
		color: var(--text-color);
	}
	.generator-progress {
		padding: 0.5em 1em;
	}
	button {
		color: var(--text-color);
	}
</style>
