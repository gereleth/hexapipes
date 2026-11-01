<script>
	import { onDestroy } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import Worker from '#lib/puzzle/worker-multi.js?worker';
	import SolverProgress from '#lib/puzzle/SolverProgress.svelte';
	import MultiTile from '#lib/puzzle/MultiTile.svelte';
	import { PipesGame } from '#lib/puzzle/game/game.svelte.js';
	import {
		applyRotations,
		buildStartTiles,
		planReuse
	} from '#lib/puzzle/generator/generator-multi.js';
	import { applyForestEvent, defaultTreeCount } from '#lib/puzzle/generator/generator-forest.js';
	import { createGrid, gridKinds, gridInfo } from '#lib/puzzle/grids/grids.js';

	/**
	 * Debug page for the multipipes generator:
	 * steps the current uniqueness loop one solver iteration at a time and
	 * shows the board with per-cell status (kept / ambiguous / unresolved),
	 * and plays the forest rewrite's growth phase move by move.
	 */

	/** @type {import('#lib/puzzle/grids/grids.js').GridKind}*/
	let gridKind = $state('square');
	let width = $state(20);
	let height = $state(20);
	let wrap = $state(false);
	let branchingAmount = $state(0.5);
	let avoidObvious = $state(0.0);
	let avoidStraights = $state(0.0);
	let sharingAmount = $state(0.35);
	/** 0 means the default max(3, floor(playable cells / 20)) */
	let treeCount = $state(0);
	/** 0 means the default max(100, 0.1 * total) */
	let maxAmbiguousTiles = $state(0);

	let generatorState = $state('idle'); // idle | starting | stepping | done
	let auto = $state(false);
	let highlightChanges = $state(true);
	/** @type {'solved'|'reused'|'growth'} */
	let boardMode = $state('solved');
	let errorMessage = $state('');

	// growth animation state
	/** @type {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid|undefined} */
	let growthGrid = $state();
	/** @type {import('#lib/puzzle/generator/generator-forest.js').ForestEvent[]} */
	let growthEvents = $state([]);
	let growthApplied = $state(0);
	/** @type {Number[][]} */
	let growthTiles = $state([]);
	/** @type {import('svelte/reactivity').SvelteSet<Number>} */
	let growthVisited = new SvelteSet();
	/** @type {import('#lib/puzzle/generator/generator-forest.js').ForestEvent|null} */
	let growthLastEvent = $state(null);
	/** @type {Number[]} */
	let growthHighlightCells = $state([]);
	let growthPlaying = $state(false);
	let growthSpeed = $state(200);
	let growthSeedFromSnapshot = $state(false);
	/** @type {ReturnType<typeof setInterval>|undefined} */
	let growthTimer;
	let growthCarry = 0;

	/** @type {Worker|null} */
	let worker = null;
	let hasWorker = $state(false);
	/** @type {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid|undefined} */
	let runGrid = $state();
	/** @type {import('#lib/puzzle/generator/generator-multi.js').IterationSnapshot[]} */
	let snapshots = $state([]);
	let viewIndex = $state(-1);

	const dummyProgress = { total: 1, solved: 0, guessed: 0, ambiguous: 0 };
	/** @type {import('#lib/puzzle/solver/solver.js').SolverProgress|null} */
	let liveProgress = $state(null);
	let liveLabel = $state('');
	let liveSeconds = $state(0);
	/** @type {ReturnType<typeof setInterval>|undefined} */
	let liveTimer;
	/** @type {{numAmbiguous: Number, elapsedMs: Number}|null} */
	let trueCount = $state(null);
	let trueCountRunning = $state(false);

	const viewSnapshot = $derived(viewIndex >= 0 ? snapshots[viewIndex] : undefined);

	/**
	 * Board size clamped to what the current settings support: wrap needs
	 * at least 3x3 so every cell keeps six distinct neighbours
	 * @returns {[Number, Number]} clamped [width, height]
	 */
	function clampedSize() {
		return [Math.max(width, wrap ? 3 : 1), Math.max(height, wrap ? 3 : 1)];
	}

	// tree count hint for the current settings; mixed grids hold more cells
	// than width * height, so ask a throwaway grid for the real playable count
	const autoTreeCount = $derived.by(() => {
		try {
			const [clampedWidth, clampedHeight] = clampedSize();
			const grid = createGrid(gridKind, clampedWidth, clampedHeight, wrap);
			return defaultTreeCount(grid.total - grid.emptyCells.size);
		} catch {
			return defaultTreeCount(width * height);
		}
	});
	const visibleCells = $derived(
		runGrid
			? runGrid.getVisibleCells({
					xmin: runGrid.XMIN,
					ymin: runGrid.YMIN,
					width: runGrid.XMAX - runGrid.XMIN,
					height: runGrid.YMAX - runGrid.YMIN
				})
			: []
	);
	const growthVisibleCells = $derived(
		growthGrid
			? growthGrid.getVisibleCells({
					xmin: growthGrid.XMIN,
					ymin: growthGrid.YMIN,
					width: growthGrid.XMAX - growthGrid.XMIN,
					height: growthGrid.YMAX - growthGrid.YMIN
				})
			: []
	);
	const game = $derived(
		viewSnapshot && runGrid
			? new PipesGame(
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
	 * Exact reuse plan of the viewed snapshot: what the NEXT iteration
	 * receives. Roles: live = the largest component (seeds the tree),
	 * island = dormant islands, dissolved = dropped (too small, conflicting,
	 * or only connected to erased cells). Cells absent from the plan were
	 * ambiguous in this iteration. Pipe masks are pruned to
	 * intra-component edges.
	 */
	const reusePlan = $derived.by(() => {
		if (!viewSnapshot || !runGrid) {
			return null;
		}
		return planReuse(runGrid, buildStartTiles(runGrid, viewSnapshot.tiles, viewSnapshot.marked), 3);
	});

	/**
	 * @param {Number} index
	 * @returns {'live'|'island'|'dissolved'|'erased'}
	 */
	function reuseRole(index) {
		const cellPlan = reusePlan?.tiles.get(index);
		if (!cellPlan) {
			return 'erased';
		}
		return cellPlan.pipes.length > 0 ? cellPlan.role : 'dissolved';
	}

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
		[width, height] = clampedSize();
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
				sharingAmount,
				branchingAmount,
				avoidObvious,
				maxAmbiguousTiles: Number(maxAmbiguousTiles) || 0
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
			const snapshot =
				/** @type {import('#lib/puzzle/generator/generator-multi.js').IterationSnapshot} */ (
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
		} else if (event.data.msg === 'growth-move') {
			growthEvents.push(event.data.move);
		} else if (event.data.msg === 'growth-done') {
			growthApplied = 0;
			growthLastEvent = null;
			growthPlaying = true;
			startGrowthTimer();
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

	function ensureWorker() {
		if (worker === null) {
			worker = new Worker();
			worker.onmessage = onWorkerMessage;
			hasWorker = true;
		}
		return worker;
	}

	function grow() {
		const w = ensureWorker();
		// ensure valid sizes
		[width, height] = clampedSize();
		errorMessage = '';
		pauseGrowth();
		growthGrid = createGrid(gridKind, width, height, wrap);
		growthEvents = [];
		growthApplied = 0;
		growthTiles = Array.from({ length: growthGrid.total }, () => []);
		growthVisited.clear();
		growthLastEvent = null;
		growthHighlightCells = [];
		w.postMessage({
			command: 'growth-start',
			grid: growthGrid.export(),
			options: {
				sharingAmount,
				branchingAmount,
				avoidObvious,
				avoidStraights,
				treeCount: Number(treeCount) || 0
			}
		});
		boardMode = 'growth';
	}

	/**
	 * Applies one forest event - growth move or merge link/fusion - to the
	 * animation board on top of the shared replay helper, tracking visited
	 * cells and the latest highlight
	 * @param {import('#lib/puzzle/generator/generator-forest.js').ForestEvent} event
	 */
	function applyGrowthEvent(event) {
		if (growthGrid) {
			applyForestEvent(growthGrid, growthTiles, event);
		}
		if (event.type === 'move') {
			growthVisited.add(event.fromCell);
			growthVisited.add(event.neighbour);
			growthHighlightCells = [event.fromCell, event.neighbour];
		} else {
			// a fusion touches one tile only
			growthVisited.add(event.cell);
			growthHighlightCells = [event.cell];
		}
		growthLastEvent = event;
		growthApplied += 1;
	}

	function growthTick() {
		const rate = Math.max(0, Number(growthSpeed) || 0);
		growthCarry += rate * 0.03;
		const count = Math.floor(growthCarry);
		if (count < 1) {
			return;
		}
		growthCarry -= count;
		for (let i = 0; i < count && growthApplied < growthEvents.length; i++) {
			applyGrowthEvent(growthEvents[growthApplied]);
		}
		if (growthApplied >= growthEvents.length) {
			pauseGrowth();
		}
	}

	function startGrowthTimer() {
		growthCarry = 0;
		if (growthTimer === undefined) {
			growthTimer = setInterval(growthTick, 30);
		}
	}

	function pauseGrowth() {
		if (growthTimer !== undefined) {
			clearInterval(growthTimer);
			growthTimer = undefined;
		}
		growthPlaying = false;
	}

	function toggleGrowthPlayback() {
		if (growthPlaying) {
			pauseGrowth();
		} else if (growthApplied < growthEvents.length) {
			growthPlaying = true;
			startGrowthTimer();
		}
	}

	function growthStepOnce() {
		pauseGrowth();
		if (growthApplied < growthEvents.length) {
			applyGrowthEvent(growthEvents[growthApplied]);
		}
	}

	/**
	 *
	 * @param {import('#lib/puzzle/generator/generator-forest.js').ForestEvent} move
	 */
	function describeGrowthEvent(move) {
		if (move.type === 'fuse') {
			return `fuse ${move.cell}`;
		}
		/** @type {Record<String, String>} */
		const descriptions = {
			seed: 'seed',
			extend: 'grow',
			share: 'share',
			link: 'link'
		};
		return `${descriptions[move.kind] || move.kind} ${move.fromCell} → ${move.neighbour}`;
	}

	onDestroy(() => {
		pauseGrowth();
		stop();
	});
</script>

<svelte:head>
	<title>Multipipes Generator Debug</title>
</svelte:head>

<div class="container">
	<h1>Multipipes Generator Debug</h1>
	<p>
		Steps the uniqueness loop one solver iteration at a time.<br />
		Solved view: green cells were reused from the previous iteration, red cells are ambiguous, gray cells
		unresolved, blue cells are newly certified; full-opacity cells changed their status vs the previous
		iteration, faded cells kept it.<br />
		Reused (erased) view — exactly what the next iteration receives: green tiles are the largest reused
		component (it seeds the growing tree), blue tiles are dormant islands (reused when the tree grows
		into them), red tiles are erased (ambiguous cells and dissolved components); circles mark deadend
		sinks. The stats line under the board accounts cells and sub-cells per fate (live / islands / carved
		around claimed cells / too small).<br />
		Growth view (press Grow): the forest engine's full run, move by move — several trees growing from
		spread-out seeds (branching 0 winds, branching 1 bushes) until no tree can move. The sharing knob
		braids trees through each other's territory: a tip reaching a foreign cell may birth a new pipe there
		(a share move), so tiles can hold several pipes and crossings appear. After growth the merge phase
		links the trees into one spanning tree (link moves join pipes across free edges; fuse moves combine
		two pipes of one shared tile into one). Green cells hold pipes, faint cells are not yet reached, blue
		outlines mark the latest move.
	</p>

	<div class="params">
		<div class="row">
			<label>
				Grid type
				<select bind:value={gridKind}>
					{#each gridKinds as kind (kind)}
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
		</div>
		<div class="row">
			<label>
				Branching
				<input type="range" min="0" max="1" step="0.05" bind:value={branchingAmount} />
			</label>
			<label>
				Sharing
				<input type="range" min="0" max="1" step="0.05" bind:value={sharingAmount} />
			</label>
			<label>
				Avoid obvious
				<input type="range" min="0" max="1" step="0.05" bind:value={avoidObvious} />
			</label>
			<label>
				Avoid straights
				<input type="range" min="0" max="1" step="0.05" bind:value={avoidStraights} />
			</label>
		</div>
		<div class="row">
			<label>
				Max ambiguous tiles
				<input
					type="number"
					bind:value={maxAmbiguousTiles}
					min="0"
					step="10"
					max={width * height}
				/>
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
		<div class="row">
			<button onclick={grow} disabled={generatorState === 'stepping'}>Grow</button>
			<label>
				Trees
				<input type="number" bind:value={treeCount} min="0" step="1" />
				(0 = auto {autoTreeCount})
			</label>
			<label title="Reused tiles feed the forest engine again once the regrowth ticket lands">
				<input type="checkbox" bind:checked={growthSeedFromSnapshot} disabled />
				grow from viewed iteration's survivors
			</label>
		</div>
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
	{#if snapshots.length > 0 || growthEvents.length > 0}
		<div class="view">
			{#if snapshots.length > 0}
				<button onclick={() => (viewIndex = Math.max(0, viewIndex - 1))} disabled={viewIndex <= 0}>
					◀
				</button>
				<span>
					iteration {viewIndex + 1} / {snapshots.length}: attempt
					{viewSnapshot?.attempt}.{viewSnapshot?.iteration}, ambiguous
					{viewSnapshot?.numAmbiguous}, kept {viewSnapshot?.keptCount},
					{Math.round(viewSnapshot?.elapsedMs ?? 0)}ms
					{viewSnapshot?.unique ? '— UNIQUE!' : ''}
				</span>
				<button
					onclick={() => (viewIndex = Math.min(snapshots.length - 1, viewIndex + 1))}
					disabled={viewIndex >= snapshots.length - 1}
				>
					▶
				</button>
			{/if}
			<span class="mode">
				<button class:active={boardMode === 'solved'} onclick={() => (boardMode = 'solved')}>
					Solved
				</button>
				<button class:active={boardMode === 'reused'} onclick={() => (boardMode = 'reused')}>
					Reused (erased)
				</button>
				<button
					class:active={boardMode === 'growth'}
					onclick={() => (boardMode = growthEvents.length > 0 ? 'growth' : boardMode)}
				>
					Growth
				</button>
			</span>
		</div>
	{/if}

	{#if snapshots.length > 0 || growthEvents.length > 0}
		<!-- the growth bar always occupies its row so the board
			does not jump when switching between views -->
		<div class="view growth-bar">
			{#if boardMode === 'growth' && growthGrid}
				<span class="growth-status">
					move {growthApplied} / {growthEvents.length}
					{growthLastEvent ? '· ' + describeGrowthEvent(growthLastEvent) : ''}
				</span>
				<span class="growth-controls">
					<button onclick={toggleGrowthPlayback} disabled={growthEvents.length === 0}>
						{growthPlaying ? 'Pause' : 'Play'}
					</button>
					<button
						onclick={growthStepOnce}
						disabled={growthPlaying || growthApplied >= growthEvents.length}
					>
						Step
					</button>
					<label>
						moves/s
						<input type="number" min="0.1" step="0.1" max="200" bind:value={growthSpeed} />
					</label>
				</span>
			{/if}
		</div>
	{/if}

	{#if viewSnapshot && game && runGrid && boardMode === 'solved'}
		{#key viewIndex}
			<svg
				class="board"
				viewBox="{runGrid.XMIN} {runGrid.YMIN} {runGrid.XMAX - runGrid.XMIN} {runGrid.YMAX -
					runGrid.YMIN}"
			>
				{#each visibleCells as cell (cell.key)}
					<MultiTile {game} i={cell.index} cx={cell.x} cy={cell.y} />
				{/each}
				<!-- status overlay goes ON TOP of the tiles:
					MultiTile paints its own opaque tile background -->
				{#each visibleCells as cell (cell.key)}
					<g transform="translate({cell.x},{cell.y})">
						<path
							d={runGrid.getCellPath(cell.index)}
							fill={statusFill(cell.index)}
							opacity={changedCells.has(cell.index) || !highlightChanges ? 1 : 0.6}
							style="transform: {runGrid.getCellTransformCSS(cell.index) || ''}
								; pointer-events: none"
						/>
					</g>
				{/each}
			</svg>
		{/key}
	{:else if viewSnapshot && runGrid && reusePlan && boardMode === 'reused'}
		<svg
			class="board"
			viewBox="{runGrid.XMIN} {runGrid.YMIN} {runGrid.XMAX - runGrid.XMIN} {runGrid.YMAX -
				runGrid.YMIN}"
		>
			{#each visibleCells as cell (cell.key)}
				{@const role = reuseRole(cell.index)}
				{@const cellPipes = reusePlan.tiles.get(cell.index)?.pipes || []}
				<g transform="translate({cell.x},{cell.y})">
					<path
						d={runGrid.getCellPath(cell.index)}
						fill={role === 'live' ? '#dfeadf' : role === 'island' ? '#dbe4f4' : '#f2dede'}
						stroke="#ccc"
						stroke-width="0.02"
						style="transform: {runGrid.getCellTransformCSS(cell.index) || ''}"
					/>
					{#if cellPipes.length > 0}
						<g style="transform: {runGrid.getCellTransformCSS(cell.index) || ''}">
							{#each cellPipes as pipe, pipeIndex (pipeIndex)}
								{@const path = runGrid.getPipePath(-pipe, cell.index)}
								{@const pipeWidth = runGrid.PIPE_WIDTH * 0.7}
								{@const isDeadend = (pipe & (pipe - 1)) === 0 && pipe > 0}
								<path
									d={path}
									stroke="#888"
									stroke-width={2 * runGrid.STROKE_WIDTH + pipeWidth}
									stroke-linejoin="bevel"
									stroke-linecap="round"
								/>
								{#if isDeadend}
									{@const center = runGrid.polygonAt(cell.index).getPipeCenter(pipe)}
									<circle
										cx={center.cx}
										cy={-center.cy}
										r={runGrid.SINK_RADIUS * 0.7}
										fill="#fff"
										stroke="#888"
										stroke-width={runGrid.STROKE_WIDTH}
									/>
								{/if}
								<path
									d={path}
									stroke="#fff"
									stroke-width={pipeWidth}
									stroke-linejoin={runGrid.LINE_JOIN}
									stroke-linecap="round"
								/>
							{/each}
						</g>
					{/if}
				</g>
			{/each}
		</svg>
	{:else if boardMode === 'growth' && growthGrid}
		<svg
			class="board"
			viewBox="{growthGrid.XMIN} {growthGrid.YMIN} {growthGrid.XMAX -
				growthGrid.XMIN} {growthGrid.YMAX - growthGrid.YMIN}"
		>
			{#each growthVisibleCells as cell (cell.key)}
				{@const cellPipes = growthTiles[cell.index] || []}
				{@const highlight = growthHighlightCells.includes(cell.index)}
				<g transform="translate({cell.x},{cell.y})">
					<path
						d={growthGrid.getCellPath(cell.index)}
						fill={growthVisited.has(cell.index) ? '#dfeadf' : '#f6f6f6'}
						stroke={highlight ? '#3d7ab8' : '#ccc'}
						stroke-width={highlight ? '0.08' : '0.02'}
						style="transform: {growthGrid.getCellTransformCSS(cell.index) || ''}"
					/>
					{#if cellPipes.length > 0}
						<g style="transform: {growthGrid.getCellTransformCSS(cell.index) || ''}">
							{#each cellPipes as pipe, pipeIndex (pipeIndex)}
								{@const path = growthGrid.getPipePath(-pipe, cell.index)}
								{@const pipeWidth = growthGrid.PIPE_WIDTH * 0.7}
								{@const isDeadend = (pipe & (pipe - 1)) === 0 && pipe > 0}
								<path
									d={path}
									stroke="#888"
									stroke-width={2 * growthGrid.STROKE_WIDTH + pipeWidth}
									stroke-linejoin="bevel"
									stroke-linecap="round"
								/>
								{#if isDeadend}
									{@const center = growthGrid.polygonAt(cell.index).getPipeCenter(pipe)}
									<circle
										cx={center.cx}
										cy={-center.cy}
										r={growthGrid.SINK_RADIUS * 0.7}
										fill="#fff"
										stroke="#888"
										stroke-width={growthGrid.STROKE_WIDTH}
									/>
								{/if}
								<path
									d={path}
									stroke="#fff"
									stroke-width={pipeWidth}
									stroke-linejoin={growthGrid.LINE_JOIN}
									stroke-linecap="round"
								/>
							{/each}
						</g>
					{/if}
				</g>
			{/each}
		</svg>
	{/if}

	{#if boardMode === 'reused' && viewSnapshot && reusePlan}
		{@const s = reusePlan.stats}
		<p class="reuse-stats">
			keepable {s.keepableCells} cells / {s.keepableNodes} sub-cells · live {s.liveCells}/
			{s.liveNodes} · islands {s.islandCells}/{s.islandNodes} · carved {s.conflictIslands}
			islands ({s.conflictWithLive} with live, {s.conflictWithIsland} with island, max
			{s.conflictMaxIslandSize}): {s.conflictLostNodes} sub-cells at claimed cells +
			{s.fragmentLostNodes} in fragments · too small {s.tooSmallLostNodes}
		</p>
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
		flex-direction: column;
		gap: 0.6em;
		align-items: center;
		margin: 1em 0;
	}
	.params .row {
		display: flex;
		flex-wrap: wrap;
		gap: 1em;
		justify-content: center;
		align-items: center;
	}
	.params label {
		display: flex;
		gap: 0.3em;
		align-items: center;
	}
	.params input[type='number'] {
		width: 6em;
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
	.growth-bar {
		justify-content: space-between;
		min-height: 2em;
	}
	.growth-status {
		text-align: left;
	}
	.growth-controls {
		display: inline-flex;
		gap: 0.7em;
		align-items: center;
		white-space: nowrap;
	}
	.mode button.active {
		background: rgba(120, 255, 120, 0.4);
		font-weight: bold;
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
	.reuse-stats {
		font-size: 0.85em;
		opacity: 0.8;
		margin: 0.3em 0;
	}
</style>
