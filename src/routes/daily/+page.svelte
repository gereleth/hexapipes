<script>
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import Puzzle from '$lib/puzzle/Puzzle.svelte';
	import PuzzleButtons from '$lib/puzzleWrapper/PuzzleButtons.svelte';
	import Timer, { formatTime } from '$lib/Timer.svelte';
	import Stats from '$lib/Stats.svelte';
	import { getSolves, getStats, settings } from '$lib/stores';

	/** @type {import('./$types').PageData} */
	export let data;

	let solve = {
		puzzleId: -1,
		startedAt: -1,
		pausedAt: -1,
		elapsedTime: -1
	};
	/** @type {import('$lib/puzzle/Puzzle.svelte').default}*/
	let puzzle;
	let solved = false;
	let progressStoreName = '/daily_progress';
	let pathname = '/daily';

	let solves;
	let stats;
	let savedProgress = undefined;
	let shareText = '';

	const nextPuzzleAt = new Date(data.date).valueOf() + 24 * 60 * 60 * 1000;
	function formatTimeLeft() {
		const now = new Date().valueOf();
		const delta = nextPuzzleAt - now;
		if (delta < 0) {
			return 'now';
		} else if (delta > 3600000) {
			const hours = Math.round(delta / 3600000);
			return `${hours} hour` + (hours > 1 ? 's' : '');
		} else if (delta > 60000) {
			const minutes = Math.round(delta / 60000);
			return `${minutes} minute` + (minutes > 1 ? 's' : '');
		} else {
			const seconds = Math.round(delta / 1000);
			return `${seconds} second` + (seconds > 1 ? 's' : '');
		}
	}
	let timeTillNextPuzzle = formatTimeLeft();

	if (browser) {
		solves = getSolves(pathname);
		stats = getStats(pathname);

		const progress = window.localStorage.getItem(progressStoreName);
		if (progress !== null) {
			const parsed = JSON.parse(progress);
			if (parsed.date === data.date) {
				savedProgress = parsed.progress;
			}
		}
	}

	function start() {
		solve = solves.reportStart(data.date);
	}

	function stop() {
		solved = true;
		solve = solves.reportFinish(data.date);
	}

	function saveProgress(event) {
		const dataStr = JSON.stringify({
			date: data.date,
			progress: event.detail.data
		});
		window.localStorage.setItem(event.detail.name, dataStr);
	}

	function startOver() {
		solved = false;
		puzzle.startOver();
	}

	onMount(() => {
		function handleVisibilityChange() {
			if (document.visibilityState === 'visible') {
				solve = solves.unpause(data.date);
			} else {
				solve = solves.pause(data.date);
			}
		}
		document.addEventListener('visibilitychange', handleVisibilityChange);
		const nextPuzzleTimer = setInterval(() => {
			timeTillNextPuzzle = formatTimeLeft();
		}, 10000);
		return () => {
			document.removeEventListener('visibilitychange', handleVisibilityChange);
			clearInterval(nextPuzzleTimer);
		};
	});

	let shareButtonIcon = '📋';
	function formatShareText(solve, showTimer) {
		let streak = '';
		if ($stats.streak > 1) {
			streak = ` - ${$stats.streak} days streak`;
		}
		if (showTimer) {
			shareText = `Daily #hexapipes puzzle ${data.date}\nSolved it in ${formatTime(
				solve.elapsedTime,
				false
			)}${streak}!\n${$page.url}`;
		} else {
			shareText = `Daily #hexapipes puzzle ${data.date}\nSolved it${streak}!\n${$page.url}`;
		}
	}

	$: if (browser) {
		formatShareText(solve, $settings.showTimer);
	}

	function copyShareText() {
		navigator.clipboard.writeText(shareText).then(
			function () {
				shareButtonIcon = '✅';
			},
			function (err) {
				console.error('Could not copy text: ', err);
				shareButtonIcon = '❌';
			}
		);
		setTimeout(() => {
			shareButtonIcon = '📋';
		}, 1000);
	}
</script>

<svelte:head>
	<title>
		Daily Pipes Puzzle {data.date}
	</title>
</svelte:head>

<div class="info container">
	<h1>Daily Pipes Puzzle {data.date}</h1>
	{#if data.comment}
		<p class="comment">{data.comment}</p>
	{/if}
	<p>Rotate the tiles so that all pipes are connected with no loops.</p>
</div>

<Puzzle
	width={data.width}
	height={data.height}
	tiles={data.tiles}
	wrap={data.wrap}
	{savedProgress}
	{progressStoreName}
	bind:this={puzzle}
	on:solved={stop}
	on:initialized={start}
	on:progress={saveProgress}
	on:pause={() => solves.pause(data.date)}
/>

<div class="container">
	<div class="congrat">
		{#if solve.elapsedTime !== -1}
			{#if solved}
				Solved!
			{/if}
		{/if}
	</div>
	<div class="next">
		{#if solve.elapsedTime !== -1}
			{#if timeTillNextPuzzle === 'now'}
				<a href="/daily" on:click={() => document.location.reload()}>Next puzzle</a>
			{:else}
				Next daily puzzle in {timeTillNextPuzzle}.
				<a href="/hexagonal/5">Play some others for now</a>
			{/if}
		{/if}
	</div>
	<PuzzleButtons
		solved={solve.elapsedTime !== -1}
		on:startOver={startOver}
		on:download={puzzle.download}
		includeNewPuzzleButton={false}
	/>
</div>
{#if solve.elapsedTime !== -1}
	<div class="container">
		<div class="share">
			<p>
				Share your result: <button on:click={copyShareText}>{shareButtonIcon} Copy text</button>
			</p>
			<textarea type="text" cols="60" rows="3" bind:value={shareText} />
		</div>
	</div>
{/if}
<div class="timings">
	<Timer {solve} />
</div>
{#if stats}
	<div class="stats">
		<Stats {stats} />
	</div>
{/if}

<div class="container instructions">
	<h2>The rules</h2>
	<ul>
		<li>All pipes must form a single contiguous network.</li>
		<li>No connections may run outside the grid.</li>
		<li>Bulb-shaped tiles are deadends.</li>
		<li>Closed loops are not allowed.</li>
		<li>Each puzzle has a unique solution.</li>
	</ul>

	<h2>Tips for controls</h2>
	<ul>
		<li>Click or tap a tile to rotate it.</li>
		<li>
			Lock tiles when you're sure of their orientation. Right click or long press to start locking.
			You can lock multiple tiles by moving the cursor around after that.
		</li>
		<li>
			Make edge marks to mark certain edges as "definitely a wall" or "definitely a connection". <br
			/>
			To make a wall mark draw a line along tile edge with a mouse or your finger. Draw a line across
			the edge for a connection mark. Do the same again to erase.<br />
			With a mouse or touch pad you can also click and hold near the edge middle to make a mark. In this
			case left mouse button makes a wall mark, right button makes a connection mark.
		</li>
		<li>
			Zoom in and out using mouse wheel or pinch-to-zoom on mobile. Click and drag to move around
			the board.
		</li>
		<li>Check out alternative control modes in the settings (top left of the puzzle).</li>
	</ul>
</div>

<style>
	.info {
		text-align: center;
	}
	.congrat {
		margin: auto;
		margin-bottom: 20px;
		font-size: 150%;
		color: var(--primary-color);
		text-align: center;
		min-height: 30px;
	}
	.next {
		margin: auto;
		margin-bottom: 20px;
		font-size: 150%;
		color: var(--text-color);
		text-align: center;
	}
	.instructions {
		color: var(--text-color);
	}
	p.comment {
		background: rgba(255, 255, 255, 0.4);
		padding: 0.5em 2em;
		border-radius: 0.5em;
		display: inline-block;
	}
	button {
		color: var(--text-color);
		min-height: 2em;
	}
	.share {
		margin: 1em auto;
		width: max-content;
		max-width: 100%;
		padding: 0.5em;
		border: 1px solid var(--secondary-color);
	}
	.share p {
		margin: 0.5em 0;
	}
	.share textarea {
		max-width: 100%;
	}
</style>
