<script>
import {settings} from '$lib/stores'
import {onMount} from 'svelte'
import Puzzle from "$lib/puzzle/Puzzle.svelte";
let hexSolved = false
let hexWrapSolved = false

onMount(()=>{
    settings.loadFromLocalStorage()
})
</script>

<svelte:head>
    <title>Pipes puzzles</title>
</svelte:head>

<div class="container">
<h1> Pipes puzzles </h1>

<p> <strong>Pipes</strong> puzzle also known as the <strong>Net</strong> or <strong>FreeNet</strong> is 
    a game where your goal is to restore a scrambled network of connections by rotating tiles of the board.
</p>

<p> It is usually played on a grid of squares. 
    That variant is available for example on <a href="https://puzzle-pipes.com" target="_blank">puzzle-pipes.com</a>
    or in Simon Tatham's puzzle <a href="https://www.chiark.greenend.org.uk/~sgtatham/puzzles/js/net.html" target="_blank">collection</a>.
</p>

<p>This site however contains the same puzzle set on a hexagonal grid. </p>

<h2> <a href="/hexagonal/5">Hexagonal pipes</a></h2>

<p>Hexagonal tiles provide more variety of tile shapes. But otherwise the logic stays the same.</p>

<p>Rotate the tiles to connect them all together with no loops. There are some features to help with the process:</p>
<ul>
    <li>Connected tiles will get a random color to help you track what's already in the network.</li>
    <li>Forming loops is forbidden by the rules so the tiles that form a loop will be highlighted with a red background.</li>
    <li>When you're sure of a tile's position you can lock it by right-clicking. This will prevent it from accidentally being rotated out of its correct position.</li>
    <li>You can make edge marks by clicking the border between two tiles. This lets you mark some edges as "definitely a wall" or "definitely a connection".</li>
</ul>

<p>Try this small puzzle right here or solve <a href="/hexagonal/5">many more like this</a> in various sizes.
Every puzzle here is guaranteed to have a unique solution.</p>

<Puzzle height={4} width={4} tiles={[1, 57, 2, 24, 40, 25, 10, 2, 4, 49, 22, 8, 48, 32, 5, 4]} wrap={false}
on:solved={()=>hexSolved = true}
/>

<p class="congrat" class:hidden={!hexSolved}>Solved!
    <a href="/hexagonal/5">Next puzzle</a>
</p>

<h2> <a href="/hexagonal-wrap/5">Hexagonal wrap pipes</a></h2>

<p>Wrap pipes are a challenging variation of the puzzle. The connections in this variant are allowed to wrap between borders of the board. Imagine copies of the puzzle placed on all sides of it (left, right, top and bottom). This way tiles on the right border can connect to tiles on the left border - or "wrap" around. </p>

<p>Unlike regular pipes puzzles the wrap variant has no convenient outer walls to start the deductions from. Hence its increased difficulty. There are some additional features to help with wrapping:</p>

<ul>
    <li>Multiple copies of the puzzle are shown, tiling the screen. When you rotate a tile then all its copies will rotate too.</li>
    <li>Zoom in/out with the mousewheel if you need to see more of the field.</li>
</ul>

<p>Try this small wrap puzzle here. There are many more <a href="/hexagonal-wrap/5">hexagonal wrap puzzles</a> for when the regular variant isn't much of a challenge any more.</p>

<Puzzle height={4} width={4} tiles={[2, 27, 18, 2, 34, 2, 8, 1, 8, 16, 45, 1, 6, 48, 53, 9]} wrap={true}
on:solved={()=>hexWrapSolved = true}
/>

<p class="congrat" class:hidden={!hexWrapSolved}>Solved! 
    <a href="/hexagonal-wrap/5">Next puzzle</a>
</p>

<h2> Changelog </h2>
<ul>
<li><em>2022-07-19</em> Improved wrap variant UI by displaying multiple copies of the puzzle tiling the screen. Fixed a bug with edgemarks not being restored from saved progress.</li>
<li><em>2022-07-11</em> Added wrap variant.</li>
<li><em>2022-07-10</em> Added solve time statistics and saving progress on a puzzle. 
    Everything should be saved to browser local storage.</li>
<li><em>2022-07-05</em> Added loop highlighting. Tiles that form a loop now get a red
background color.</li>
<li><em>2022-07-03</em> Added edge marks - now it's possible to mark an edge as 
a connection or a wall.</li>
<li><em>2022-07-02</em> Added a new control mode - click to orient. It takes less 
clicks than the default "click to rotate" but requires more precision with 
where you click.</li>
<li><em>2022-06-30</em> Added a thousand puzzle instances for sizes up to 40x40.
     Reworked navigation to show random puzzles.</li>
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