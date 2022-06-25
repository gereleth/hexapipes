<script>
  import {page} from '$app/stores'
</script>

<h1> Hexagonal pipes </h1>

<div class="sizes">
  <span> Choose a size:</span>
  {#each [5,7,10,15] as size}
    <a href="/hexagonal/{size}" class:active={$page.url.pathname.includes(`/hexagonal/${size}`)}> {size}x{size} </a>
  {/each}
</div>
<slot />

<style>
.sizes {
  display: flex;
  column-gap: 20px;
  margin: auto;
  width: max-content;
}
.sizes a, .sizes span {
  display: block;
  padding: 5px;
}
.active {
  outline: 1px solid  var(--accent-color);
}
</style>