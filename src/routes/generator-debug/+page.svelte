<script>
	import { onDestroy } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import Worker from '$lib/puzzle/worker-layers.js?worker';
	import SolverProgress from '$lib/puzzle/SolverProgress.svelte';
	import LayeredTile from '$lib/puzzle/LayeredTile.svelte';
	import { LayeredPipesGame } from '$lib/puzzle/game-layers.svelte';
	import { applyRotations } from '$lib/puzzle/generator-layers';
	import { createGrid, gridKinds, gridInfo } from '$lib/puzzle/grids/grids';

	/**
	 * Debug page for the layered uniqueness generation loop:
	 * steps the generator one solver iteration at a time and shows
	 * the board with per-cell status (kept / ambiguous / unresolved)
	 * so the convergence behavior can be inspected visually.
	 */

	/** @type {import('$lib/puzzle/grids/grids').GridKind}*/
	let gridKind = $state('square');
	let width = $state(20);
	let height = $state(20);
	let wrap = $state(false);
	let branchingAmount = $state(0.5);
	let avoidObvious = $state(0.0);
	/** 0 means the default max(100, 0.1 * total) */
	let maxAmbiguousTiles = $state(0);

	let generatorState = $state('idle'); // idle | starting | stepping | done
	let auto = $state(false);
	let highlightChanges = $state(true);
	let errorMessage = $state('');

	/** @type {Worker|null} */
	let worker = null;
	let hasWorker = $state(false);
	/** @type {import('$lib/puzzle/grids/abstractgrid').AbstractGrid|undefined} */
	let runGrid = $state();
	/** @type {import('$lib/puzzle/generator-layers').IterationSnapshot[]} */
	let snapshots = $state([]);
	let viewIndex = $state(-1);

	const dummyProgress = { total: 1, solved: 0, guessed: 0, ambiguous: 0 };
	/** @type {import('$lib/puzzle/solver-layers').SolverProgress|null} */
	let liveProgress = $state(null);
	let liveLabel = $state('');
	let liveSeconds = $state(0);
	/** @type {ReturnType<typeof setInterval>|undefined} */
	let liveTimer;
	/** @type {{numAmbiguous: Number, elapsedMs: Number}|null} */
	let trueCount = $state(null);
	let trueCountRunning = $state(false);

	const viewSnapshot = $derived(viewIndex >= 0 ? snapshots[viewIndex] : undefined);
	const visibleCells = $derived(
		runGrid
			? runGrid.getVisibleTiles({
					xmin: runGrid.XMIN,
					ymin: runGrid.YMIN,
					width: runGrid.XMAX - runGrid.XMIN,
					height: runGrid.YMAX - runGrid.YMIN
				})
			: []
	);
	const game = $derived(
		viewSnapshot && runGrid
			? new LayeredPipesGame(
					runGrid,
					applyRotations(runGrid, viewSnapshot.tiles, viewSnapshot.marked),
					undefined
				)
			: undefined
	);
	// cells whose status changed vs the previous iteration
	const changedCells = $derived.by(() => {
		if (!viewSnapshot || viewIndex === 0) {
			return new SvelteSet();
		}
		const previous = snapshots[viewIndex - 1];
		const changed = new SvelteSet();
		for (let i = 0; i < viewSnapshot.marked.length; i++) {
			const bad = viewSnapshot.marked[i] < 0;
			const badBefore = previous.marked[i] < 0;
			if (bad !== badBefore) {
				changed.add(i);
			}
		}
		return changed;
	});

	/**
	 * @param {Number} index
	 */
	function statusFill(index) {
		if (!viewSnapshot) {
			return 'none';
		}
		const marked = viewSnapshot.marked[index];
		if (marked === -2) {
			return 'rgba(255,80,80,0.55)';
		}
		if (marked === -1) {
			return 'rgba(120,120,120,0.45)';
		}
		if (viewIndex > 0 && snapshots[viewIndex - 1].marked[index] >= 0) {
			return 'rgba(80,200,80,0.5)';
		}
		return 'rgba(90,150,255,0.35)';
	}

	function start() {
		stop();
		// ensure valid sizes
		width = Math.max(width, wrap ? 3 : 1);
		height = Math.max(height, wrap ? 3 : 1);
		errorMessage = '';
		snapshots = [];
		trueCount = null;
		runGrid = createGrid(gridKind, width, height, wrap);
		viewIndex = -1;
		hasWorker = true;
		worker = new Worker();
		worker.onmessage = onWorkerMessage;
		worker.postMessage({
			command: 'debug-start',
			grid: runGrid.export(),
			options: {
				branchingAmount,
				avoidObvious,
				maxAmbiguousTiles: Number(maxAmbiguousTiles) || 0,
				solutionsNumber: 'unique'
			}
		});
		generatorState = 'starting';
	}

	function step() {
		if (worker === null || generatorState === 'stepping') {
			return;
		}
		liveProgress = dummyProgress;
		liveSeconds = 0;
		liveLabel = `attempt ${snapshots.at(-1)?.attempt ?? 1}, next iteration`;
		liveTimer = setInterval(() => {
			liveSeconds += 0.1;
		}, 100);
		generatorState = 'stepping';
		worker.postMessage({ command: 'debug-step' });
	}

	/**
	 *
	 * @param {MessageEvent<any>} event
	 */
	function onWorkerMessage(event) {
		if (event.data.msg === 'debug-ready') {
			step();
		} else if (event.data.msg === 'solver_progress') {
			if (generatorState === 'stepping') {
				liveProgress = event.data.progress;
				liveLabel = `attempt ${snapshots.at(-1)?.attempt ?? 1}, iteration ${snapshots.length + 1}`;
			}
		} else if (event.data.msg === 'iteration') {
			stopLiveTimer();
			liveProgress = null;
			const snapshot = /** @type {import('$lib/puzzle/generator-layers').IterationSnapshot} */ (
				event.data
			);
			snapshots.push(snapshot);
			viewIndex = snapshots.length - 1;
			if (snapshot.unique) {
				generatorState = 'done';
				auto = false;
				return;
			}
			generatorState = 'idle';
			if (auto) {
				setTimeout(step, 30);
			}
		} else if (event.data.msg === 'debug-done') {
			generatorState = 'done';
			auto = false;
			stopLiveTimer();
			liveProgress = null;
		} else if (event.data.msg === 'true-count') {
			trueCount = {
				numAmbiguous: event.data.numAmbiguous,
				elapsedMs: event.data.elapsedMs
			};
			trueCountRunning = false;
		} else if (event.data.msg === 'error') {
			errorMessage = '' + event.data.error;
			generatorState = 'idle';
			auto = false;
			trueCountRunning = false;
			stopLiveTimer();
			liveProgress = null;
		}
	}

	function stopLiveTimer() {
		if (liveTimer !== undefined) {
			clearInterval(liveTimer);
			liveTimer = undefined;
		}
	}

	function stop() {
		auto = false;
		stopLiveTimer();
		hasWorker = false;
		worker?.terminate();
		worker = null;
		generatorState = 'idle';
		liveProgress = null;
		trueCountRunning = false;
	}

	function requestTrueCount() {
		if (worker === null || trueCountRunning || !viewSnapshot) {
			return;
		}
		trueCountRunning = true;
		trueCount = null;
		worker.postMessage({ command: 'debug-true-count' });
	}

	onDestroy(() => {
		stop();
	});
</script>

<svelte:head>
	<title>Layered Generator Debug</title>
</svelte:head>

<div class="container">
	<h1>Layered Generator Debug</h1>
	<p>
		Steps the uniqueness loop one solver iteration at a time. Green cells were reused from the
		previous iteration, red cells are ambiguous, gray cells unresolved, blue cells are newly
		certified. Full-opacity cells changed their status vs the previous iteration, faded cells kept
		it.
	</p>

	<div class="params">
		<label>
			Grid type
			<select bind:value={gridKind}>
				{#each gridKinds.filter((kind) => kind === 'square' || kind === 'hexagonal') as kind (kind)}
					<option value={kind}>{gridInfo[kind].title}</option>
				{/each}
			</select>
		</label>
		<label>
			Width <input type="number" bind:value={width} min="3" />
		</label>
		<label>
			Height <input type="number" bind:value={height} min="3" />
		</label>
		<label>
			Wrap <input type="checkbox" bind:checked={wrap} />
		</label>
		<label>
			Branching
			<input type="range" min="0" max="1" step="0.05" bind:value={branchingAmount} />
		</label>
		<label>
			Avoid obvious
			<input type="range" min="0" max="1" step="0.05" bind:value={avoidObvious} />
		</label>
		<label>
			Max ambiguous tiles
			<input type="number" bind:value={maxAmbiguousTiles} min="0" step="10" max={width * height} />
			(0 = auto {Math.max(100, Math.round(0.1 * width * height))})
		</label>
		<button onclick={start} disabled={generatorState === 'stepping'}>Start</button>
		<button onclick={step} disabled={generatorState === 'stepping' || !hasWorker}> Step </button>
		<button
			onclick={() => {
				auto = true;
				if (generatorState !== 'stepping') {
					step();
				}
			}}
			disabled={!hasWorker || generatorState === 'done'}
		>
			Auto
		</button>
		<button onclick={() => stop()} disabled={!hasWorker}>Stop</button>
		<label>
			<input type="checkbox" bind:checked={auto} disabled={!hasWorker} /> auto-run
		</label>
		<label>
			<input type="checkbox" bind:checked={highlightChanges} /> highlight changes
		</label>
	</div>

	{#if errorMessage !== ''}
		<div class="error">{errorMessage}</div>
	{/if}

	{#if liveProgress}
		<div class="live">
			<span>{liveLabel}</span>
			<span>{liveSeconds.toFixed(1)}s</span>
			<SolverProgress progress={liveProgress} />
		</div>
	{/if}

	{#if snapshots.length > 0}
		<div class="view">
			<button onclick={() => (viewIndex = Math.max(0, viewIndex - 1))} disabled={viewIndex <= 0}>
				◀
			</button>
			<span>
				iteration {viewIndex + 1} / {snapshots.length}: attempt
				{viewSnapshot?.attempt}.{viewSnapshot?.iteration}, ambiguous {viewSnapshot?.numAmbiguous},
				kept {viewSnapshot?.keptCount},
				{Math.round(viewSnapshot?.elapsedMs ?? 0)}ms
				{viewSnapshot?.unique ? '— UNIQUE!' : ''}
			</span>
			<button
				onclick={() => (viewIndex = Math.min(snapshots.length - 1, viewIndex + 1))}
				disabled={viewIndex >= snapshots.length - 1}
			>
				▶
			</button>
		</div>
	{/if}

	{#if viewSnapshot && game && runGrid}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<svg
			class="board"
			viewBox="{runGrid.XMIN} {runGrid.YMIN} {runGrid.XMAX - runGrid.XMIN} {runGrid.YMAX -
				runGrid.YMIN}"
		>
			{#each visibleCells as cell (cell.key)}
				<LayeredTile {game} i={cell.index} cx={cell.x} cy={cell.y} />
			{/each}
			<!-- status overlay goes ON TOP of the tiles:
				LayeredTile paints its own opaque tile background -->
			{#each visibleCells as cell (cell.key)}
				<g transform="translate({cell.x},{cell.y})">
					<path
						d={runGrid.getTilePath(cell.index)}
						fill={statusFill(cell.index)}
						opacity={changedCells.has(cell.index) || !highlightChanges ? 1 : 0.6}
						style="transform: {runGrid.getTileTransformCSS(cell.index) || ''}
							; pointer-events: none"
					/>
				</g>
			{/each}
		</svg>
	{/if}

	{#if runGrid && !viewSnapshot}
		<p>Press Start to begin a run.</p>
	{/if}

	{#if snapshots.length > 0 && runGrid}
		<div class="history">
			<div class="history-title">Iterations (newest first)</div>
			{#each [...snapshots].reverse() as snapshot, i (snapshots.length - i)}
				{@const index = snapshots.length - 1 - i}
				<div class="history-row" class:viewed={index === viewIndex}>
					<span class="label">
						#{index + 1} (a{snapshot.attempt}.{snapshot.iteration})
					</span>
					<span class="bar">
						<span class="seg amb" style="width: {(100 * snapshot.numAmbiguous) / runGrid.total}%"
						></span><span
							class="seg kept"
							style="width: {(100 * snapshot.keptCount) / runGrid.total}%"
						></span>
					</span>
					<span class="numbers">
						amb {snapshot.numAmbiguous}, kept {snapshot.keptCount},
						{Math.round(snapshot.elapsedMs)}ms{snapshot.unique ? ' UNIQUE' : ''}
					</span>
					<button onclick={() => (viewIndex = index)}>view</button>
				</div>
			{/each}
		</div>
	{/if}

	{#if snapshots.length > 0}
		<div class="true-count">
			<button
				onclick={requestTrueCount}
				disabled={trueCountRunning || generatorState === 'stepping'}
			>
				True ambiguity count of viewed iteration
			</button>
			(may take a long time: no limit on the marking search)
			{#if trueCount}
				<div>
					true ambiguous: {trueCount.numAmbiguous} ({Math.round(trueCount.elapsedMs)}ms)
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.container {
		text-align: center;
		color: var(--text-color);
	}
	.params {
		display: flex;
		flex-wrap: wrap;
		gap: 1em;
		justify-content: center;
		align-items: center;
		margin: 1em 0;
	}
	.params label {
		display: flex;
		gap: 0.3em;
		align-items: center;
	}
	button {
		color: var(--text-color);
		cursor: pointer;
	}
	.error {
		padding: 1em;
		background-color: rgba(255, 0, 0, 0.1);
	}
	.live {
		display: flex;
		flex-direction: column;
		gap: 0.2em;
		width: 60%;
		margin: 0.5em auto;
	}
	.view {
		display: flex;
		gap: 1em;
		justify-content: center;
		align-items: center;
		margin: 0.5em 0;
	}
	.board {
		width: min(90vw, 700px);
		max-height: 70vh;
	}
	.history {
		width: min(90vw, 700px);
		margin: 1em auto;
		text-align: left;
	}
	.history-title {
		font-weight: bold;
		margin-bottom: 0.3em;
	}
	.history-row {
		display: flex;
		gap: 0.7em;
		align-items: center;
		padding: 0.1em 0;
	}
	.history-row.viewed {
		background: rgba(120, 255, 120, 0.25);
	}
	.history-row .label {
		min-width: 6.5em;
	}
	.history-row .bar {
		display: inline-flex;
		flex-grow: 1;
		height: 0.5em;
		background: rgba(120, 120, 120, 0.3);
	}
	.history-row .seg {
		height: 100%;
	}
	.history-row .seg.amb {
		background: rgba(255, 80, 80, 0.8);
	}
	.history-row .seg.kept {
		background: rgba(80, 200, 80, 0.8);
	}
	.history-row .numbers {
		font-size: 0.85em;
		white-space: nowrap;
	}
	.true-count {
		margin: 1em 0;
	}
</style>
