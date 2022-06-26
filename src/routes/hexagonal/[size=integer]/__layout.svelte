<script>
  import {page} from '$app/stores';
</script>

<slot />

<div class="container">
  <div class="links">
    <p>Other {$page.params.size}x{$page.params.size} puzzles:</p>
    {#each Array(100) as _, i}
      <a href="/hexagonal/{$page.params.size}/{i+1}" 
        class:active={$page.url.pathname === `/hexagonal/${$page.params.size}/${i+1}`}> 
        {i+1} 
      </a>
    {/each}
  </div>
</div>

<style>
  .links {
    display: flex;
    width: 500px;
    flex-wrap: wrap;
    margin: auto;
    row-gap: 10px;
  }
  .links p {
    width: 100%;
    text-align: center;
  }
  .links a {
    display: block;
    flex-basis: 10%;
    text-align: center;
  }
  .active {
    outline: 1px solid  var(--accent-color);
  }
</style>