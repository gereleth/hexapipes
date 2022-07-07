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
  import { onMount } from 'svelte'
  import { page } from '$app/stores';
  import Puzzle from '$lib/puzzle/Puzzle.svelte';
  import Timer from '$lib/Timer.svelte';
  import {getSolves, puzzleCounts} from '$lib/stores';
  export let width
  export let height
  export let tiles
  let solved = false
  let nextPuzzleId = 1
  
  let solves // a store of puzzles solve times
  let solve = {
        puzzleId: -1,
        startedAt: -1,
        finishedAt: -1,
        elapsedTime: -1,
    }



  $: if ($page.params) {
    solved = false
  }

  onMount(() => {
    solves = getSolves($page.url.pathname)
    start()
  });

  function start() {
    // console.log('start')
    if (solves!==undefined) {
      solve = solves.reportStart(Number($page.params.id))
    }
  }

  function stop() {
    // console.log('stop')
    solved = true
    solve = solves.reportFinish(Number($page.params.id))
    nextPuzzleId = solves.choosePuzzleId(
      $puzzleCounts[`${$page.params.size}x${$page.params.size}`], 
      Number($page.params.id)
    )
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

<div class="container">
  <div class="congrat"> 
    {#if solved} 
      Solved! 
      <a href="/hexagonal/{$page.params.size}/{nextPuzzleId}">Next puzzle</a> 
    {/if}
  </div>
  <div class="timings">
    <Timer {solve} />
  </div>
</div>

{#key $page.params}
  <Puzzle {width} {height} {tiles}
     on:solved={stop}
     on:initialized={start}
  />
{/key}


<style>
.congrat {
    margin: auto;
    font-size: 150%;
    color: var(--primary-color);
    text-align: center;
    min-height: 30px;
}
.info {
  text-align: center;
}
</style>