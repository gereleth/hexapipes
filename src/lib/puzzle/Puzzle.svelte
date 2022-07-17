<script>
    import { browser } from '$app/env'
    import { HexaGrid } from "$lib/puzzle/hexagrid";
    import { settings } from '$lib/stores';
    import Tile from '$lib/puzzle/Tile.svelte';
    import EdgeMark from '$lib/puzzle/EdgeMark.svelte';
    import { onMount, onDestroy, createEventDispatcher } from 'svelte';
    import { PipesGame } from '$lib/puzzle/game';

    export let width = 0
    export let height = 0
    /** @type {Number[]} */
    export let tiles = []
    export let wrap = false
    export let savedProgress
    let svgWidth = 500
    let svgHeight = 500

    let grid = new HexaGrid(width, height, wrap)
    let game = new PipesGame(grid, tiles, savedProgress)
    let solved = game.solved

    let displayTiles = game.tileStates

    const dispatch = createEventDispatcher()

    let innerWidth = 500
    let innerHeight = 500

    let edgeMarks = grid.getEdgeMarks()

    const wallMarks = new Set()
    const connectionMarks = new Set()

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
        dispatch('initialized')
    })

    onDestroy(()=>{
        // save progress immediately if navigating away (?)
        // console.log('clear timer because destroy')
        save.clear()
        if (!$solved) {save.now()}
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
        const data = {
            tiles: displayTiles.map(tile => {
                return {
                    rotations: tile.rotations,
                    color: tile.color,
                    locked: tile.locked,
                }
            }),
            wallMarks: [...wallMarks],
            connectionMarks: [...connectionMarks],
        }
        // dispatch('progress', data)
    }

    const save = createThrottle(saveProgress, 3000)


    function handleEdgeMark(event, index) {
        const state = event.detail
        if (state==='wall') {
            wallMarks.add(index)
            connectionMarks.delete(index)
        } else if (state==='connection') {
            wallMarks.delete(index)
            connectionMarks.add(index)
        } else {
            wallMarks.delete(index)
            connectionMarks.delete(index)
        }
        save.soon()
    }

    let previousWrapNeighbours = []

    function highlightWrapNeighbours(event) {
        const wrapNeighbours = event.detail
        for (let [index, direction] of previousWrapNeighbours) {
            displayTiles[index].highlightDirections.delete(direction)
            displayTiles[index].highlightDirections = displayTiles[index].highlightDirections
        }
        for (let [index, direction] of wrapNeighbours) {
            displayTiles[index].highlightDirections.add(direction)
            displayTiles[index].highlightDirections = displayTiles[index].highlightDirections
        }
        previousWrapNeighbours = wrapNeighbours
    }

    function zoom(ev) {
        ev.preventDefault()
        const svg = ev.target.closest('svg')
        const {x, y, width, height} = svg.getBoundingClientRect()
        grid = grid.zoom(
            ev.deltaY, 
            (ev.clientX - x) / width, 
            (ev.clientY - y)/ height
        )
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
        {#each displayTiles as displayTile, i (i)}
            <Tile {i} solved={$solved} {game}
                controlMode={$settings.controlMode}
                highlightDirections={displayTile.highlightDirections}
                on:connections={game.handleConnections}
                on:toggleLocked={()=> {if (!$solved) {save.soon()}}}
                on:highlightWrap={highlightWrapNeighbours}
                />
        {/each}
        {#if !$solved}
            {#each edgeMarks as mark, i}
                <EdgeMark 
                    {grid}
                    x={mark.x} 
                    y={mark.y} 
                    state={mark.state} 
                    direction={mark.direction}
                    wrapX={mark.wrapX}
                    wrapY={mark.wrapY}
                    on:toggle={ev => handleEdgeMark(ev, i)}
                    />
            {/each}
        {/if}
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
