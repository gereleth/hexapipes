<script context="module">
  export async function load({ params, fetch }) {
    const size = `${params.size}x${params.size}`
    const id = Number(params.id)
    const folderNum = Math.floor((id-1)/100)
    const url = `/_instances/hexagonal/${size}/${folderNum}/${id}.json`;
    const response = await fetch(url);

    if (response.ok) {
      const data = await response.json()
      return {
        status: response.status,
        props: {
          width: data.width,
          height: data.height,
          tiles: data.tiles,
        }
      }
    } else {
      return {
      status: response.status,
    };
    }
  }
</script>

<script>
  import { page } from '$app/stores';
  import Puzzle from '$lib/puzzle/Puzzle.svelte';
  import {puzzleCounts} from '$lib/stores';
  export let width
  export let height
  export let tiles
  let solved = false
  let nextPuzzleId = 0

  $: if ($page.params) {
    solved = false
    const size = $page.params.size
    nextPuzzleId = Math.ceil(Math.random() * $puzzleCounts[`${size}x${size}`])
  }

</script>

<svelte:head>
  <title>
    {$page.params.size}x{$page.params.size} Hexagonal Pipes Puzzle #{$page.params.id}
  </title>
</svelte:head>


<div class="info container">
  <h2> {$page.params.size}x{$page.params.size} Hexagonal Pipes Puzzle #{$page.params.id}</h2>
  
  <p>Rotate the tiles so that all pipes are connected with no loops.</p>
</div>

{#key $page.params}
  <Puzzle {width} {height} {tiles} on:solved={()=>{solved=true}}/>
{/key}

<div class="container">
  {#if solved} 
    <div class="congrat"> 
      Solved! 
      <a href="/hexagonal/{$page.params.size}/{nextPuzzleId}">Next puzzle</a> 
    </div>
  {/if}
</div>

<style>
.congrat {
    margin: auto;
    font-size: 150%;
    color: var(--primary-color);
    text-align: center;
}
.info {
  text-align: center;
}
</style>