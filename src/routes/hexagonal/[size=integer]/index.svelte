<script>
  import {onMount} from 'svelte'
  import {goto} from '$app/navigation'
  import {page} from '$app/stores'
  import {puzzleCounts} from '$lib/stores'

  onMount(async () => {
      const size = $page.params.size
      const id = Math.ceil(Math.random() * $puzzleCounts[`${size}x${size}`])
      await goto(`/hexagonal/${size}/${id}`)
  })
</script>

<div class="container">
  <p> This should redirect to a random puzzle page soon. </p>
</div>
<style>
p {
  text-align: center;
}
</style>