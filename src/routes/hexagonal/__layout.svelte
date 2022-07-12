<script>
  import { puzzleCounts } from '$lib/stores'
  import {page} from '$app/stores'
  import Settings from '$lib/settings/Settings.svelte';

  /** @type {Number[]} */
  let sizes = []
  $: sizes = [...Object.entries($puzzleCounts.hexagonal)].map(
    item => Number(item[0].split('x')[0])
  ).sort((a, b) => a - b)
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
<Settings />
<slot />

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
</style>