<script>
  import {onMount} from 'svelte'
  import {goto} from '$app/navigation'

  onMount(async () => {
      await goto(`/hexagonal/5/1`)
  })
</script>

<p> This should redirect to a puzzle page soon. </p>

<style>
p {
  text-align: center;
}
</style>