<script>
	import { onMount, onDestroy, createEventDispatcher } from 'svelte';
	import { slide } from 'svelte/transition';
	import Worker from '$lib/puzzle/worker.js?worker';
	import SolverProgress from '$lib/puzzle/SolverProgress.svelte';

	// Grid properties
	export let width = 3;
	export let height = 3;
	export let wrap = false;
	export let gridKind = 'hexagonal';

	/**@type {NodeJS.Timeout|undefined}*/
	let timer;
	/** @type {Worker|null} */
	let worker = null;
	let showGenProgress = false;
	const dummyProgress = { total: 1, solved: 0, guessed: 0, ambiguous: 0 };
	/** @type {import('$lib/puzzle/solver').SolverProgress[]}*/
	let solverProgressItems = [];
	const dispatch = createEventDispatcher();

	/**
	 *
	 * @param {import('$lib/puzzle/generator').GeneratorOptions} options
	 */
	export function generate(options) {
		worker = new Worker();
		worker.onmessage = onWorkerMessage;
		worker.postMessage({
			command: 'generate',
			grid: {
				kind: gridKind,
				width,
				height,
				wrap
			},
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
		dispatch('cancel');
	}

	/**
	 *
	 * @param {MessageEvent<any>} event
	 */
	function onWorkerMessage(event) {
		if (event.data.msg === 'generated') {
			dispatch('generated', { tiles: event.data.tiles });
			showGenProgress = false;
			clearTimeout(timer);
		} else if (event.data.msg === 'error') {
			dispatch('error', event.data.error);
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
	<div class="progress" transition:slide|local>
		<div
			class="generator-progress"
			style="background: linear-gradient(0deg, 
			rgba(170,255,170,1) 0%, 
			rgba(255,255,255,0) 100%);"
		>
			Generating a puzzle... <button on:click={cancel}>Cancel</button>
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
