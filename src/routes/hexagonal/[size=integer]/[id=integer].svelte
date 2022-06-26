<script>
  import { page } from '$app/stores';
  import Puzzle from '$lib/puzzle/Puzzle.svelte';
  export let width
  export let height
  export let tiles
  let solved = false
  $: $page.params, solved = false
</script>

<div class="info container">
<h2> Hexagonal pipes {$page.params.size}x{$page.params.size} puzzle #{$page.params.id}</h2>

<p>Rotate the tiles so that all pipes are connected with no loops.</p>
</div>

{#key $page.params.size, $page.params.id}
  <Puzzle {width} {height} {tiles} on:solved={()=>{solved=true}}/>
{/key}

{#if solved} 
    <div class="congrat"> 
      Solved! 
      <a href="/hexagonal/{$page.params.size}/{$page.params.id === '100' ? 1 : Number($page.params.id) + 1}">Next puzzle</a> </div>
{/if}
<style>
.info {
  text-align: center;
}
.congrat {
    margin: auto;
    font-size: 150%;
    color: var(--primary-color);
    text-align: center;
}
</style>