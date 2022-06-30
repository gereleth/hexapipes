<script context="module">

  import { puzzleCounts } from '$lib/stores'

  export async function load({ params, fetch }) {
  const url = `/data.json`;
  const response = await fetch(url);

  if (response.ok) {
    const data = await response.json()
    
    puzzleCounts.set(data.totalPuzzles)

    return {
      status: response.status,
      props: {
        totalPuzzles: data.totalPuzzles,
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
  import {page} from '$app/stores'
  /* type Number[] */
  let sizes = []
  $: sizes = [...Object.entries($puzzleCounts)].map(item => Number(item[0].split('x')[0])).sort((a, b) => a - b)
</script>

<div class="container">
  <h1> Hexagonal pipes </h1>

  <div class="sizes">
    <span> Choose a size:</span>
    {#each sizes as size}
      <a href="/hexagonal/{size}" 
        class:active={$page.url.pathname.includes(`/hexagonal/${size}`)}> 
        {size}x{size}
      </a>
    {/each}
  </div>
</div>

<slot />


<div class="controls">
  <h2>Controls</h2>
  <ul>
    <li>Click / touch - rotate tile clockwise</li>
    <li>Right click / long press - pin tile</li>
    <li>Ctrl-click - rotate tile counter-clockwise</li>
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
.sizes a, .sizes span {
  display: block;
  padding: 5px;
}
.active {
  outline: 1px solid  var(--accent-color);
}
.controls {
  margin: 2em 0;
  text-align: center;
  color: var(--text-color)
}
</style>