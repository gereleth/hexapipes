<script>
  import {onMount} from 'svelte'
  import {goto} from '$app/navigation'

  onMount(async () => {
      await goto(`/hexagonal/5/1`)
  })
</script>
<div class="container">
  <p> This should redirect to a puzzle page soon. </p>
</div>

<style>
p {
  text-align: center;
}
</style>