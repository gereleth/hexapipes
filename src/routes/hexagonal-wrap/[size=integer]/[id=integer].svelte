<script context="module">
  export async function load({ params, fetch }) {
    const size = `${params.size}x${params.size}`
    const id = Number(params.id)
    const folderNum = Math.floor((id-1)/100)
    const url = `/_instances/hexagonal-wrap/${size}/${folderNum}/${id}.json`;
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
  import { browser } from '$app/env';
  import Puzzle from '$lib/puzzle/Puzzle.svelte';
  import Timer from '$lib/Timer.svelte';
  import Stats from '$lib/Stats.svelte';
  import {getSolves, getStats, puzzleCounts} from '$lib/stores';
  export let width
  export let height
  export let tiles
  let solved = false
  let nextPuzzleId = 1
  
  let solves // a store of puzzles solve times
  let stats // a store of puzzle time stats

  let progressStoreName = ''
  let savedProgress

  $: progressStoreName = $page.url.pathname + '_progress'

  let solve = {
        puzzleId: -1,
        startedAt: -1,
        finishedAt: -1,
        elapsedTime: -1,
    }



  $: if (browser && $page.params) {
    solved = false
    const progress = window.localStorage.getItem(progressStoreName)
    if (progress !== null) {
      savedProgress = JSON.parse(progress)
    } else {
      savedProgress = undefined
    }
  }

  onMount(() => {
    solves = getSolves($page.url.pathname)
    stats = getStats($page.url.pathname)
    start()
  });

  function start() {
    // console.log('start')
    if (solves!==undefined) {
      solve = solves.reportStart(Number($page.params.id))
      if (solve.elapsedTime !== -1) {
        nextPuzzleId = solves.choosePuzzleId(
          $puzzleCounts.hexagonalWrap[`${$page.params.size}x${$page.params.size}`], 
          Number($page.params.id)
        )
      }
    }
  }

  function restart() {
    const progress = window.localStorage.removeItem(progressStoreName)
    savedProgress = undefined
    if (solves!==undefined) {
      solve = solves.reportReset(Number($page.params.id))
    }
  }

  function stop() {
    // console.log('stop')
    solved = true
    solve = solves.reportFinish(Number($page.params.id))
    nextPuzzleId = solves.choosePuzzleId(
      $puzzleCounts.hexagonalWrap[`${$page.params.size}x${$page.params.size}`], 
      Number($page.params.id)
    )
    window.localStorage.removeItem(progressStoreName)
  }

  function saveProgress(event) {
    const data = JSON.stringify(event.detail)
    window.localStorage.setItem(progressStoreName, data)
  }
</script>

<svelte:head>
  <title>
    {$page.params.size}x{$page.params.size} Hexagonal Wrap Pipes Puzzle #{$page.params.id}
  </title>
</svelte:head>


<div class="info container">
  <h2> {$page.params.size}x{$page.params.size} Hexagonal Wrap Pipes Puzzle #{$page.params.id}</h2>
  
  <p>Rotate the tiles so that all pipes are connected with no loops. The puzzle wraps around and connects back to itself - left to right and top to bottom.</p>

  <p> 
    Multiple copies of tiles are shown to help you solve. Use mouse wheel to zoom in/out.</p>
</div>

{#key $page.params}
  <Puzzle {width} {height} {tiles} {savedProgress} wrap={true}
     on:solved={stop}
     on:initialized={start}
     on:progress={saveProgress}
     on:reset={restart}
  />
{/key}

<div class="container">
  <div class="congrat"> 
    {#if solve.elapsedTime !== -1}
      {#if solved}
        Solved! 
      {/if}
      <a href="/hexagonal-wrap/{$page.params.size}/{nextPuzzleId}">Next puzzle</a> 
    {/if}
  </div>
</div>

<div class="timings">
  <Timer {solve}/>
</div>
{#if stats}
  <div class="stats">
    <Stats {stats}/>
  </div>
{/if}

<style>
.congrat {
    margin: auto;
    margin-bottom: 20px;
    font-size: 150%;
    color: var(--primary-color);
    text-align: center;
    min-height: 30px;
}
.info {
  text-align: center;
}
</style>