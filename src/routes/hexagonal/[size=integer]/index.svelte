<script>
  import {onMount} from 'svelte'
  import {goto} from '$app/navigation'
  import {page} from '$app/stores'

  onMount(async () => {
      const size = $page.params.size
      await goto(`/hexagonal/${size}/1`)
  })
</script>

<p> This should redirect to a puzzle page soon. </p>

<style>
p {
  text-align: center;
}
</style>