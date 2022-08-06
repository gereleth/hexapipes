<script>
    import { browser } from '$app/env'
    import { HexaGrid } from "$lib/puzzle/hexagrid";
    import { settings } from '$lib/stores';
    import Tile from '$lib/puzzle/Tile.svelte';
    import { onMount, onDestroy, createEventDispatcher } from 'svelte';
    import { PipesGame } from '$lib/puzzle/game';

    export let width = 0
    export let height = 0
    /** @type {Number[]} */
    export let tiles = []
    export let wrap = false
    export let savedProgress
    export let progressStoreName = ''

    // Remember the name that the puzzle was created with
    // to prevent accidental saving to another puzzle's progress
    // if a user navigates between puzzles directly via back/forward buttons
    const myProgressName = progressStoreName

    let svgWidth = 500
    let svgHeight = 500

    let grid = new HexaGrid(width, height, wrap)
    let game = new PipesGame(grid, tiles, savedProgress)
    let solved = game.solved

    let visibleTiles = grid.getVisibleTiles()

    const dispatch = createEventDispatcher()

    let innerWidth = 500
    let innerHeight = 500

    export const startOver = function() {
        game.startOver()
    }

    /**
     * @param {Number} innerWidth
     * @param {Number} innerHeight
     * @returns {void}
     */
    function resize(innerWidth, innerHeight) {
        const wpx = innerWidth / (1 + grid.xmax - grid.xmin)
        const hpx = innerHeight / (1 + grid.ymax - grid.ymin)
        const pxPerCell = Math.min(100, Math.min(wpx, hpx))
        svgWidth = pxPerCell*(grid.xmax - grid.xmin)
        svgHeight = pxPerCell*(grid.ymax - grid.ymin)
    }

    onMount(()=>{
        game.initializeBoard()
        resize(innerWidth, innerHeight)
        console.log('dispatching initialized')
        dispatch('initialized')
    })

    onDestroy(()=>{
        // save progress immediately if navigating away (?)
        save.clear()
        if (!$solved) {
            save.now()
            console.log('dispatching pause')
            dispatch('pause')
        }
    })

    function createThrottle(callback, timeout) {
        let throttleTimer = null
        const throttle = (callback, timeout) => {
            if (throttleTimer!==null) return;
                throttleTimer = setTimeout(() => {
                    callback();
                    throttleTimer = null;
                }, timeout);
        }
        const clear = () => {
            if (throttleTimer !== null) {
                clearTimeout(throttleTimer)
                throttleTimer = null
            }
        }
        return {
            now: ()=>(callback()),
            soon: ()=>throttle(callback, timeout),
            clear,
        }
    }

    function saveProgress() {
        if ($solved) {
            return
        }
        const tileStates = game.tileStates.map(tile => {
            const data = tile.data
            return {
                rotations: data.rotations,
                locked: data.locked,
                color: data.color,
                edgeMarks: data.edgeMarks,
            }
        })
        dispatch('progress', {
            name: myProgressName,
            data: {
                tiles: tileStates,
            },
        })
    }

    const save = createThrottle(saveProgress, 3000)

    function zoom(ev) {
        if (!grid.wrap) {
            // only on wrap puzzles for now
            return
        }
        ev.preventDefault()
        const svg = ev.target.closest('svg')
        const {x, y, width, height} = svg.getBoundingClientRect()
        grid = grid.zoom(
            ev.deltaY, 
            (ev.clientX - x) / width, 
            (ev.clientY - y)/ height
        )
        visibleTiles = grid.getVisibleTiles()
    }
    let isTouching = false
    $: if (browser) document.body.classList.toggle('no-selection', isTouching);

    $: if ($solved) {
        dispatch('solved')
    }
</script>

<svelte:window bind:innerWidth bind:innerHeight />

<div class="puzzle" class:solved={$solved}>
    <svg 
        width={svgWidth} 
        height={svgHeight}
        viewBox="{grid.xmin} {grid.ymin} {grid.xmax - grid.xmin} {grid.ymax - grid.ymin}"
        on:mousedown|preventDefault={()=>{}}
        on:contextmenu|preventDefault={()=>{}}
        on:touchstart={()=>isTouching=true}
        on:touchend={()=>isTouching=false}
        on:wheel={zoom}
        >
        {#each visibleTiles as visibleTile, i (visibleTile.key)}
            <Tile i={visibleTile.index} solved={$solved} {game}
                cx={visibleTile.x}
                cy={visibleTile.y}
                controlMode={$settings.controlMode}
                on:connections={game.handleConnections}
                on:save={save.soon}
                />
        {/each}
    </svg>
</div>

<style>
    svg {
        display: block;
        margin: auto;
    }
    /* win animation */
    .solved :global(.inside) {
        filter: hue-rotate(360deg);
        transition: filter 2s;
    }
</style>
