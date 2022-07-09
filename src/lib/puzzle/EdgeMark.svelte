<script>
    import { XY_DELTAS, YSTEP, OPPOSITE } from '$lib/hexagrid';
    import {fade} from 'svelte/transition';
    import {createEventDispatcher} from 'svelte'
    export let x = 0
    export let y = 0
    export let state='none'
    export let direction = 1
    let dx = 0, dy=0
    
    const dispatch = createEventDispatcher()

    $: [dx, dy] = XY_DELTAS.get(OPPOSITE.get(direction))

    function toggleState() {
        if (state==='none') {
            state = 'wall'
        } else if (state==='wall') {
            state='connection'
        } else {
            state = 'none'
        }
        dispatch('toggle', state)
    }
    const lineLength = 0.15
</script>

{#if state!=='none'}
    <line 
        transition:fade|local={{duration: 100}}
        class='mark'
        class:wall = {state==='wall'}
        class:connection = {state==='connection'}
        x1={x-dx*lineLength}
        y1={y+dy*lineLength}
        x2={x+dx*lineLength}
        y2={y-dy*lineLength}
        stroke="green"
        stroke-width="0.04" />
{/if}
<circle 
    class="clickarea"
     cx={x} cy={y} r=0.08
     on:click={toggleState}
     on:contextmenu={()=>{toggleState(), toggleState()}}
     />

<style>
    .clickarea {
        fill: rgba(0,0,0,0);
        cursor: pointer;
    }
    .mark {
        transform-origin: center;
        transform-box: fill-box;
        transition: transform 100ms;
    }
    .wall {
        stroke: #ff3e00;
        transform: rotate(90deg)
    }
    .connection {
        stroke: #00b82d
    }
</style>