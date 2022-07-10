
<svelte:head>
    <title>Pipes puzzles</title>
</svelte:head>

<div class="container">
<h1> Pipes puzzles </h1>

<p> This is an under construction site with variants of the pipes puzzle.</p> 

<p> Only the <a href="/hexagonal/5/1"> hexagonal </a> variety is available for now.</p>

<h2> Changelog </h2>
<ul>
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
        color: var(--text-color)
    }
</style>