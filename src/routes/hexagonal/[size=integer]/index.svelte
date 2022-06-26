<script>
  import {onMount} from 'svelte'
  import {goto} from '$app/navigation'
  import {page} from '$app/stores'

  onMount(async () => {
      const size = $page.params.size
      await goto(`/hexagonal/${size}/1`)
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