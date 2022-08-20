<script>
	import { puzzleCounts } from '$lib/stores';
	import { page } from '$app/stores';

	/** @type {Number[]} */
	let sizes = [];
	$: sizes = [...Object.entries($puzzleCounts.hexagonal)]
		.map((item) => Number(item[0].split('x')[0]))
		.sort((a, b) => a - b);
</script>

<div class="container">
	<h1>Hexagonal pipes</h1>

	<div class="sizes">
		<span> Choose a size:</span>
		{#each sizes as size}
			<a href="/hexagonal/{size}" class:active={$page.url.pathname.includes(`/hexagonal/${size}`)}>
				{size}x{size}
			</a>
		{/each}
	</div>
</div>
<slot />

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
	.sizes {
		display: flex;
		flex-wrap: wrap;
		column-gap: 20px;
		margin: auto;
		justify-content: center;
	}
	.sizes a,
	.sizes span {
		display: block;
		padding: 5px;
	}
	.active {
		outline: 1px solid var(--accent-color);
	}
	.instructions {
		color: var(--text-color);
	}
</style>
