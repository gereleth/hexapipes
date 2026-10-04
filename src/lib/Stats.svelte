<script>
	import { formatTime } from '#lib/Timer.svelte';
	import { settings } from '#lib/stores.js';
	/** @typedef {Object} Props
	 * @property {import('#lib/solvelogs.svelte.js').SolveStats} stats
	 * @property {import('#lib/solvelogs.svelte.js').SolveStats} previousStats
	 */
	/** @type {Props}*/
	const { stats, previousStats } = $props();
</script>

<div class="stats container">
	{#if stats.streak !== -1}
		{#if $settings.showTimer}
			<div class="improvements">
				{#if stats.bestTime < previousStats.bestTime}
					{@const current = stats.bestTime}
					{@const previous = previousStats.bestTime}
					{#if Number.isFinite(previous)}
						<p>
							Improved best time: <strong>{formatTime(current)}</strong>
							(was {formatTime(previous)})
						</p>
					{:else}
						<p>New best time: <strong>{formatTime(current)}</strong></p>
					{/if}
				{/if}
				{#if stats.bestMeanOf3 < previousStats.bestMeanOf3}
					{@const current = stats.bestMeanOf3}
					{@const previous = previousStats.bestMeanOf3}
					{#if Number.isFinite(previous)}
						<p>
							Improved <span class="metric" title="Mean of 3 consecutive solve times">
								mean of 3
							</span>:
							<strong>{formatTime(current)}</strong>
							(was {formatTime(previous)})
						</p>
					{:else}
						<p>
							New <span class="metric" title="Mean of 3 consecutive solve times"> mean of 3 </span>:
							<strong>{formatTime(current)}</strong>
						</p>
					{/if}
				{/if}
				{#if stats.bestAverageOf5 < previousStats.bestAverageOf5}
					{@const current = stats.bestAverageOf5}
					{@const previous = previousStats.bestAverageOf5}
					{#if Number.isFinite(previous)}
						<p>
							Improved <span
								class="metric"
								title="Mean of 5 consecutive solve times excluding the best and the worst time"
							>
								average of 5
							</span>:
							<strong>{formatTime(current)}</strong>
							(was {formatTime(previous)})
						</p>
					{:else}
						<p>
							New <span
								class="metric"
								title="Mean of 5 consecutive solve times excluding the best and the worst time"
							>
								average of 5
							</span>: <strong>{formatTime(current)}</strong>
						</p>
					{/if}
				{/if}
				{#if stats.bestAverageOf12 < previousStats.bestAverageOf12}
					{@const current = stats.bestAverageOf12}
					{@const previous = previousStats.bestAverageOf12}
					{#if Number.isFinite(previous)}
						<p>
							Improved <span
								class="metric"
								title="Mean of 12 consecutive solve times excluding the best and the worst time"
							>
								average of 12
							</span>:
							<strong>{formatTime(current)}</strong>
							(was {formatTime(previous)})
						</p>
					{:else}
						<p>
							New <span
								class="metric"
								title="Mean of 12 consecutive solve times excluding the best and the worst time"
							>
								average of 12
							</span>: <strong>{formatTime(current)}</strong>
						</p>
					{/if}
				{/if}
			</div>
		{/if}
		<div class="details">
			<details>
				<summary>Solve stats</summary>
				<p>Total puzzles solved: {stats.totalSolved} ({stats.streak} in a row)</p>
				<table>
					<thead>
						<tr>
							<th></th>
							<th>Current</th>
							<th>Best</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td>Single puzzle</td>
							<td>{formatTime(stats.currentTime)}</td>
							<td>{formatTime(stats.bestTime)}</td>
						</tr>
						<tr>
							<td
								><span class="metric" title="Mean of 3 consecutive solve times">Mean of 3</span></td
							>
							<td>{formatTime(stats.meanOf3)}</td>
							<td>{formatTime(stats.bestMeanOf3)}</td>
						</tr>
						<tr>
							<td
								><span
									class="metric"
									title="Mean of 5 consecutive solve times excluding the best and the worst time"
									>Average of 5</span
								></td
							>
							<td>{formatTime(stats.averageOf5)}</td>
							<td>{formatTime(stats.bestAverageOf5)}</td>
						</tr>
						<tr>
							<td
								><span
									class="metric"
									title="Mean of 12 consecutive solve times excluding the best and the worst time"
									>Average of 12</span
								></td
							>
							<td>{formatTime(stats.averageOf12)}</td>
							<td>{formatTime(stats.bestAverageOf12)}</td>
						</tr>
					</tbody>
				</table>
			</details>
		</div>
	{/if}
</div>

<style>
	.stats {
		color: var(--text-color);
	}

	summary {
		text-decoration: underline 1px dashed;
	}

	.improvements {
		text-align: center;
	}
	.improvements p::before {
		content: '⭐';
		margin-right: 0.5em;
	}
	.metric {
		text-decoration: underline dotted 1px;
	}
	.details {
		display: flex;
		justify-content: center;
		margin-top: 20px;
	}
	details {
		width: max-content;
		max-width: 99vw;
		margin-bottom: 100px;
	}
	details summary {
		cursor: pointer;
	}
	table {
		border-collapse: collapse;
	}
	td,
	th {
		padding: 3px 10px;
		border-bottom: 1px solid gray;
	}
</style>
