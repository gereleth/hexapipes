<script>
	import { formatTime } from '$lib/Timer.svelte';
	export let stats; // a store of time and streak statistics
</script>

<div class="stats container">
	{#if $stats.streak !== -1}
		<div class="improvements">
			{#if $stats.single.best < $stats.single.previousBest}
				{#if Number.isFinite($stats.single.previousBest)}
					<p>
						Improved best time: <strong>{formatTime($stats.single.best)}</strong>
						(was {formatTime($stats.single.previousBest)})
					</p>
				{:else}
					<p>New best time: <strong>{formatTime($stats.single.best)}</strong></p>
				{/if}
			{/if}
			{#if $stats.meanOf3.best < $stats.meanOf3.previousBest}
				{#if Number.isFinite($stats.meanOf3.previousBest)}
					<p>
						Improved <span class="metric" title="Mean of 3 consecutive solve times">mean of 3</span
						>: <strong>{formatTime($stats.meanOf3.best)}</strong>
						(was {formatTime($stats.meanOf3.previousBest)})
					</p>
				{:else}
					<p>
						New <span class="metric" title="Mean of 3 consecutive solve times">mean of 3</span>:
						<strong>{formatTime($stats.meanOf3.best)}</strong>
					</p>
				{/if}
			{/if}
			{#if $stats.averageOf5.best < $stats.averageOf5.previousBest}
				{#if Number.isFinite($stats.averageOf5.previousBest)}
					<p>
						Improved <span
							class="metric"
							title="Mean of 5 consecutive solve times excluding the best and the worst time"
							>average of 5</span
						>: <strong>{formatTime($stats.averageOf5.best)}</strong>
						(was {formatTime($stats.averageOf5.previousBest)})
					</p>
				{:else}
					<p>
						New <span
							class="metric"
							title="Mean of 5 consecutive solve times excluding the best and the worst time"
							>average of 5</span
						>: <strong>{formatTime($stats.averageOf5.best)}</strong>
					</p>
				{/if}
			{/if}
			{#if $stats.averageOf12.best < $stats.averageOf12.previousBest}
				{#if Number.isFinite($stats.averageOf12.previousBest)}
					<p>
						Improved <span
							class="metric"
							title="Mean of 12 consecutive solve times excluding the best and the worst time"
							>average of 12</span
						>: <strong>{formatTime($stats.averageOf12.best)}</strong>
						(was {formatTime($stats.averageOf12.previousBest)})
					</p>
				{:else}
					<p>
						New <span
							class="metric"
							title="Mean of 12 consecutive solve times excluding the best and the worst time"
							>average of 12</span
						>: <strong>{formatTime($stats.averageOf12.best)}</strong>
					</p>
				{/if}
			{/if}
		</div>
        <div class="details">
            <details>
                <summary>Solve stats</summary>
                <p>Total puzzles solved: {$stats.totalSolved} ({$stats.streak} in a row)</p>
                <table>
                    <thead>
                        <tr>
                            <th />
                            <th>Current</th>
                            <th>Best</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>Single puzzle</td>
                            <td>{formatTime($stats.single.current)}</td>
                            <td>{formatTime($stats.single.best)}</td>
                        </tr>
                        <tr>
                            <td><span class="metric" title="Mean of 3 consecutive solve times">Mean of 3</span></td>
                            <td>{formatTime($stats.meanOf3.current)}</td>
                            <td>{formatTime($stats.meanOf3.best)}</td>
                        </tr>
                        <tr>
                            <td
                                ><span
                                    class="metric"
                                    title="Mean of 5 consecutive solve times excluding the best and the worst time"
                                    >Average of 5</span
                                ></td
                            >
                            <td>{formatTime($stats.averageOf5.current)}</td>
                            <td>{formatTime($stats.averageOf5.best)}</td>
                        </tr>
                        <tr>
                            <td
                                ><span
                                    class="metric"
                                    title="Mean of 12 consecutive solve times excluding the best and the worst time"
                                    >Average of 12</span
                                ></td
                            >
                            <td>{formatTime($stats.averageOf12.current)}</td>
                            <td>{formatTime($stats.averageOf12.best)}</td>
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
        cursor: pointer
    }
    table {
        border-collapse: collapse;
    }
    td, th {
        padding: 3px 10px;
        border-bottom: 1px solid gray;
    }
</style>
