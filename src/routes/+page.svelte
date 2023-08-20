<script>
	import { settings } from '$lib/stores';
	import { onMount } from 'svelte';
	import Puzzle from '$lib/puzzle/Puzzle.svelte';
	import { createGrid } from '$lib/puzzle/grids/grids';
	import GridsExamples from '$lib/header/GridsExamples.svelte';

	const hexGrid = createGrid('hexagonal', 4, 4, false);
	const hexWrapGrid = createGrid('hexagonal', 4, 4, true);
	let hexSolved = false;
	let hexWrapSolved = false;

	onMount(() => {
		settings.loadFromLocalStorage();
	});
</script>

<svelte:head>
	<title>Pipes puzzles</title>
</svelte:head>

<div class="container">
	<h1>Pipes puzzles</h1>

	<p>
		<strong>Pipes</strong> puzzle also known as the <strong>Net</strong> or <strong>FreeNet</strong>
		is a game where your goal is to restore a scrambled network of connections by rotating tiles of the
		board.
	</p>

	<p>
		It is usually played on a grid of squares. That variant is available for example on <a
			href="https://puzzle-pipes.com"
			target="_blank"
			rel="noreferrer">puzzle-pipes.com</a
		>
		or in Simon Tatham's puzzle
		<a
			href="https://www.chiark.greenend.org.uk/~sgtatham/puzzles/js/net.html"
			target="_blank"
			rel="noreferrer">collection</a
		>.
	</p>

	<p>This site however contains the same puzzle set on various grids:</p>

	<GridsExamples />

	<h2><a href="/hexagonal/5">Hexagonal pipes</a></h2>

	<p>
		Hexagonal tiles provide more variety of tile shapes. But otherwise the logic stays the same.
	</p>

	<p>
		Rotate the tiles to connect them all together with no loops. There are some features to help
		with the process:
	</p>
	<ul>
		<li>
			Connected tiles will get a random color to help you track what's already in the network.
		</li>
		<li>
			Forming loops is forbidden by the rules so the tiles that form a loop will be highlighted with
			a red background.
		</li>
		<li>
			When you're sure of a tile's position you can lock it by right-clicking. This will prevent it
			from accidentally being rotated out of its correct position.
		</li>
		<li>
			You can make edge marks by drawing a line across or along tile border. This lets you mark some
			edges as "definitely a wall" or "definitely a connection".
		</li>
	</ul>

	<p>
		Try this small puzzle right here or solve <a href="/hexagonal/5">many more like this</a> in various
		sizes. Every puzzle here is guaranteed to have a unique solution.
	</p>
</div>
<Puzzle
	grid={hexGrid}
	tiles={[1, 57, 2, 24, 40, 25, 10, 2, 4, 49, 22, 8, 48, 32, 5, 4]}
	on:solved={() => (hexSolved = true)}
/>
<div class="container">
	<p class="congrat" class:hidden={!hexSolved}>
		Solved!
		<a href="/hexagonal/5">Next puzzle</a>
	</p>

	<h2><a href="/hexagonal-wrap/5">Hexagonal wrap pipes</a></h2>

	<p>
		Wrap pipes are a challenging variation of the puzzle. The connections in this variant are
		allowed to wrap between borders of the board. Imagine copies of the puzzle placed on all sides
		of it (left, right, top and bottom). This way tiles on the right border can connect to tiles on
		the left border - or "wrap" around.
	</p>

	<p>
		Unlike regular pipes puzzles the wrap variant has no convenient outer walls to start the
		deductions from. Hence its increased difficulty. To help deal with wrap edges multiple copies of
		the puzzle are shown, tiling the screen. When you rotate a tile all its copies will rotate too.
	</p>

	<p>
		Try this small wrap puzzle here. There are many more <a href="/hexagonal-wrap/5"
			>hexagonal wrap puzzles</a
		> for when the regular variant isn't much of a challenge any more.
	</p>
</div>
<Puzzle
	grid={hexWrapGrid}
	tiles={[2, 27, 18, 2, 34, 2, 8, 1, 8, 16, 45, 1, 6, 48, 53, 9]}
	on:solved={() => (hexWrapSolved = true)}
/>

<p class="congrat" class:hidden={!hexWrapSolved}>
	Solved!
	<a href="/hexagonal-wrap/5">Next puzzle</a>
</p>
<div class="container">
	<h2>Changelog</h2>
	<ul>
		<li>
			<em>2023-08-20</em> Fixed a <a href="https://github.com/gereleth/hexapipes/issues/102">bug</a>
			in calculating "Average of 12" statistic for daily puzzles.
		</li>
		<li>
			<em>2023-06-11</em> New grid! You've played with squares before, how about some
			<a href="/cube/5">cubes</a>?
			<ul>
				<li>
					Thanks to <a href="https://github.com/gordonwoodhull" target="_blank" rel="noreferrer"
						>Gordon Woodhull</a
					> for the implementation!
				</li>
				<li>Cubes difficulty is pretty gentle, there's plenty of new patterns to figure out.</li>
				<li>Win animation is now "brighten to white and back" instead of hue rotation.</li>
			</ul>
		</li>
		<li>
			<em>2023-05-19</em> New grid with <a href="/etrat/5">elongated triangular tiling</a>.
			<ul>
				<li>
					A combination of square and triangular tiles creates pretty challenging puzzles! These are
					considerably harder than other grids so far.
				</li>
			</ul>
		</li>
		<li>
			<em>2023-04-22</em> Islands and disconnects highlighting.
			<ul>
				<li>
					As you get closer to solving a puzzle the remaining disconnected pieces will get a darker
					border to make them easier to notice.
				</li>
				<li>Islands are now shown with a reddish border so you know to break them up somewhere.</li>
			</ul>
		</li>
		<li>
			<em>2023-04-15</em> Some QOL improvements.
			<ul>
				<li>
					Touchpad zooming and panning should now work consistently with your page scrolling
					behaviour. If you have further issues with touchpad controls please report them
					<a
						href="https://github.com/gereleth/hexapipes/issues/87"
						target="_blank"
						rel="noreferrer"
					>
						here
					</a>.
				</li>
				<li>
					Decreased timeout for "click and hold" edgemark creation and for locking tiles in touch
					mode.
				</li>
				<li>Added a setting for animation speed so your pipes can rotate faster.</li>
			</ul>
		</li>
		<li>
			<em>2023-04-02</em> Add octagonal grid puzzles.
			<ul>
				<li>
					After a decent amount of work we support non-uniform grids! Try out the
					<a href="/octagonal/5">octagonal</a> or <a href="/octagonal-wrap/5">octagonal wrap</a> pipes.
					They're quite a challenge!
				</li>
				<li>
					I reworked the navigation a little because the list of grid types was getting unwieldy. I
					hope to add more fun tilings soon.
				</li>
			</ul>
		</li>
		<li>
			<em>2023-03-18</em> Add square grid puzzles.
			<ul>
				<li>
					Play the classic variant of pipes:
					<a href="/square/5">square</a> and <a href="/square-wrap/5">square-wrap</a>.
				</li>
			</ul>
		</li>
		<li>
			<em>2023-03-05</em> Export/import of puzzles as json files. Plus some new generator options.
			<ul>
				<li>
					You can now download a puzzle as a json file. Open the downloaded file on the
					<a href="/custom">custom puzzle page</a>. If a daily is too hard you can let the solver
					have a go at it =).
				</li>
				<li>
					Custom puzzle page has a new setting to "Avoid obvious tiles". This can spice up regular
					puzzles by avoiding things like straight tiles along outer walls.
				</li>
				<li>
					You can also ask the generator for a puzzle with multiple solutions. See if you can spot
					the ambiguities =).
				</li>
			</ul>
		</li>
		<li>
			<em>2023-02-19</em> Automate obvious stuff away with a smart assistant.
			<ul>
				<li>
					When you lock a tile or create an edge mark the surrounding tiles will rotate to match.
					Enable the assistant in the settings and give it a try.
				</li>
				<li>
					I also did some tweaks to edgemark gesture detection to make them somewhat less finicky
					and easier to create.
				</li>
			</ul>
		</li>
		<li>
			<em>2023-01-21</em> Switch to client-side generated puzzles
			<ul>
				<li>
					Say hello to an infinite supply of puzzles that are now generated for you client-side.
					Static puzzles stay accessible at their direct links but won't normally be used any more.
				</li>
				<li>
					Play puzzles of any NxN size by changing the number in the url. For example, go to <a
						href="/hexagonal/50">/hexagonal/50</a
					> for 50x50 puzzles. Please tweet a screenshot at me if you complete something that huge =).
				</li>
				<li>
					<a href="/custom">Custom puzzle page</a> now has a "branching" control. Low branching values
					create puzzles with long winding corridors, high branching leads to lots of intersections and
					deadends. This affects puzzle difficulty: try a wrap puzzle with low branching if you want
					something evil.
				</li>
			</ul>
		</li>
		<li>
			<em>2022-12-12</em> Changed settings placement
			<ul>
				<li>
					The settings can now be accessed through a button below the puzzle. This should make them
					more
					<a
						href="https://github.com/gereleth/hexapipes/issues/60"
						target="_blank"
						rel="noreferrer"
					>
						discoverable
					</a>.
				</li>
			</ul>
		</li>
		<li>
			<em>2022-12-05</em> Client-side puzzle generation
			<ul>
				<li>
					I've rewritten puzzle solving and generation logic from python to js. So now you can try
					generated puzzles of any size at the <a href="/custom">custom puzzle page</a>.
				</li>
				<li>
					The custom page doesn't currently have progress saving or timings so please don't start a
					100x100 unless you have enough time to finish it in one go =).
				</li>
				<li>There's a "Solve it" button too so you can watch the robot work on a puzzle.</li>
			</ul>
		</li>
		<li>
			<em>2022-08-30</em> More minor updates:
			<ul>
				<li>
					<a href="https://github.com/adamburgess" target="_blank" rel="noreferrer">Adam Burgess</a>
					fixed a bug with seconds countdown display on daily puzzle page. Thanks =).
				</li>
				<li>
					Improved handling of X tiles in click to orient control mode. The guiding dot is now
					placed consistently between top ends of the X instead of on a random end.
				</li>
			</ul>
		</li>
		<li>
			<em>2022-08-28</em> Minor quality of life updates
			<ul>
				<li>Zoom level now stays the same when you click "Next puzzle".</li>
				<li>Next puzzle is prefetched while you solve to provide instant navigation.</li>
			</ul>
		</li>
		<li>
			<em>2022-08-27</em> Some changes for daily puzzles:
			<ul>
				<li>
					Changed streak calculation logic for daily puzzles - missed days are now counted as not
					solved. Included streak length in share text.
				</li>
				<li>
					Did minor updates to controls for upcoming daily puzzles with holes. It's now possible to
					zoom/pan when the cursor is over an empty tile.
				</li>
			</ul>
		</li>
		<li>
			<em>2022-08-21</em> Added initial version of daily puzzles.
		</li>
		<li>
			<em>2022-08-15</em>
			<ul>
				<li>
					Added a setting to disable zoom/pan because the new functions weren't working well for
					some users. If you use the setting then puzzles will be shown fully zoomed out like before
					and you can rely on browser zoom to deal with small tiles.
				</li>
				<li>
					As a small improvement made the page keep scroll position the same when you click "Next
					puzzle".
				</li>
			</ul>
		</li>
		<li>
			<em>2022-08-13</em> The timer now stops ticking when you leave the puzzle page or switch to a
			different tab. It continues when you return to the puzzle. This should give more accurate
			times on large puzzles. Thanks to
			<a href="https://github.com/joshwilsonvu" target="_blank" rel="noreferrer">@joshwilsonvu</a> for
			the pull request.
		</li>
		<li>
			<em>2022-08-11</em> Zoom and pan! Solving big puzzles should be easier now with the ability to
			zoom in and move around. A summary of improved controls:
			<ul>
				<li>Zoom in and out with the mouse wheel. Pinch to zoom on mobile or with a touchpad.</li>
				<li>
					Click/touch and drag to pan. Panning starts after the distance traveled is > 1 tile width.
				</li>
				<li>
					Right click or longpress to start locking tiles. Once started you can lock multiple tiles
					by moving the cursor around.
				</li>
				<li>
					Make edge marks by drawing a line near the edge middle. A line along the edge makes a wall
					mark, across the edge - a connection mark. Draw again to erase. With a mouse or touchpad
					you can also click and hold near the edge middle to place an edge mark. In this case left
					mouse button makes a wall mark, right button makes a connection mark.
				</li>
				<li>Click to rotate tiles (as before)</li>
			</ul>
		</li>
		<li>
			<em>2022-07-31</em> Added some buttons based on HN feedback:
			<ul>
				<li>Start over - reverts the puzzle to initial state</li>
				<li>Hide timer - hides solve times</li>
				<li>New puzzle - lets you skip current puzzle and start another one</li>
			</ul>
		</li>
		<li>
			<em>2022-07-30</em> Some bug fixes and improvements:
			<ul>
				<li>Added large wrap puzzles: 20x20, 30x30, 40x40.</li>
				<li>Fixed browser back button not working after changing puzzle size or type.</li>
				<li>
					Fixed multiple solutions found in some of the wrap puzzles. This was done by replacing a
					few of the tiles to remove ambiguity. If you had saved progress in one of the affected
					puzzles then the replaced area might look strange and might have to be redone.
				</li>
			</ul>
		</li>
		<li>
			<em>2022-07-19</em> Improved wrap variant UI by displaying multiple copies of the puzzle tiling
			the screen. Fixed a bug with edgemarks not being restored from saved progress.
		</li>
		<li><em>2022-07-11</em> Added wrap variant.</li>
		<li>
			<em>2022-07-10</em> Added solve time statistics and saving progress on a puzzle. Everything should
			be saved to browser local storage.
		</li>
		<li>
			<em>2022-07-05</em> Added loop highlighting. Tiles that form a loop now get a red background color.
		</li>
		<li>
			<em>2022-07-03</em> Added edge marks - now it's possible to mark an edge as a connection or a wall.
		</li>
		<li>
			<em>2022-07-02</em> Added a new control mode - click to orient. It takes less clicks than the default
			"click to rotate" but requires more precision with where you click.
		</li>
		<li>
			<em>2022-06-30</em> Added a thousand puzzle instances for sizes up to 40x40. Reworked navigation
			to show random puzzles.
		</li>
		<li><em>2022-06-28</em> Made tiles look like actual hexagons instead of circles</li>
		<li><em>2022-06-27</em> Added flow visualisation with random colors</li>
		<li><em>2022-06-25</em> Initial release of hexagonal pipes puzzles</li>
	</ul>
</div>

<style>
	ul {
		color: var(--text-color);
		line-height: 1.5;
	}
	h2 {
		font-size: 150%;
	}
	.congrat {
		color: var(--primary-color);
		font-size: 150%;
		text-align: center;
	}
	.hidden {
		visibility: hidden;
	}
</style>
