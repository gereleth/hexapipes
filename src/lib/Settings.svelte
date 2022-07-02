<script>
import {settings} from '$lib/stores'
import {onMount} from 'svelte'

let hidden = true

onMount(()=>{
    settings.loadFromLocalStorage()
})
</script>


<div class="container settings" class:hidden>
    <h2 on:click={()=>{hidden=!hidden}} >
        Settings
        {#if !hidden}
             (click to hide)
        {/if}
    </h2>
    {#if !hidden}
    <div class="controlMode">
        <h3>Controls mode</h3>
        <label>
            <input type=radio 
                bind:group={$settings.controlMode} 
                name="controlMode" 
                value={'click_to_rotate'}>
            Click to rotate
        </label>
        <label>
            <input type=radio 
                bind:group={$settings.controlMode} 
                name="controlMode" 
                value={'click_to_orient'}>
            Click to orient
        </label>
        <div class="description">
            {#if $settings.controlMode === 'click_to_rotate'}
                <ul>
                    <li>Click / touch - rotate tile clockwise</li>
                    <li>Right click / long press - pin tile</li>
                    <li>Ctrl-click - rotate tile counter-clockwise</li>
                </ul>
            {:else if $settings.controlMode === 'click_to_orient'}
            <ul>
                <li>Click or touch once to orient the tile in that direction.</li>
                <li>A tile will rotate so that the little orange dot moves to where you clicked.</li>
                <li>Right click / long press - pin tile</li>
            </ul>
            {/if}

        </div>
    </div>
    {/if}
</div>

<style>
    .settings {
        color: var(--text-color);
        background: whitesmoke;
        border-radius: 5px;
        padding: 5px;
        margin: 5px auto;
    }
    .settings.hidden {
        background: none;
        padding: 0;
    }
    h2 {
        text-decoration: underline dashed;
        cursor: pointer;
    }
</style>