<script>
    import { HexaGrid, YSTEP } from "$lib/hexagrid";
    import Tile from '$lib/puzzle/Tile.svelte';
    import { onMount, createEventDispatcher } from 'svelte';

    /**
     * @param {Number[]} tiles
     * @param {Number} width
     * @param {Number} height
     */
    export let width = 0// = 5
    export let height = 0// = 5
    export let tiles = [
    ]
    let solved = false

    const dispatch = createEventDispatcher()

    let grid = new HexaGrid(width, height)
    let connections = new Map([])
    let pxPerCell = 100
    
    let innerWidth = 500
    let innerHeight = 500
    let startCheckAtIndex = 0

    $: pxPerCell = resize(innerWidth, innerHeight)

    function resize(innerWidth, innerHeight) {
        const wpx = innerWidth / (width + 1.6)
        const hpx = innerHeight / (YSTEP*(height + 0.5))
        return Math.min(100, Math.min(wpx, hpx))
    }

    function handleConnections(event) {
        const {tileIndex, dirIn, dirOut} = event.detail
        // console.log(tileIndex, dirIn, dirOut)
        if (connections.has(tileIndex)) {
            const tileConnections = connections.get(tileIndex)
            dirOut.forEach(direction => {
                // console.log(grid.find_neighbour(tileIndex, direction))
                tileConnections.delete(grid.find_neighbour(tileIndex, direction))
            })
            dirIn.forEach(direction => {
                tileConnections.add(grid.find_neighbour(tileIndex, direction))
            })
        } else {
            connections.set(tileIndex, new Set(dirIn.map(direction => {
                return grid.find_neighbour(tileIndex, direction)
            })))
        }
        if (event.detail.from==='user') {
            solved = isSolved()
        }
    }

    function isSolved() {
        // console.log('=================== Solved check ======================')
        let toCheck = new Set([{fromIndex: -1, tileIndex: startCheckAtIndex}])
        console.log('start at', startCheckAtIndex)
        const checked = new Set([])
        while (toCheck.size > 0) {
            // console.log('toCheck = ', toCheck)
            const newChecks = new Set([])
            for (let{fromIndex, tileIndex} of toCheck) {
                // console.log('checking tile', tileIndex, 'coming from', fromIndex)
                const neighbours = connections.get(tileIndex)
                // console.log('tile neighbours', neighbours)
                for (let neighbour of neighbours) {
                    // console.log('checking neighbour', neighbour)
                    if (neighbour===-1) {
                        // not solved if any tiles point outside
                        // console.log('not solved for outside connection in tile', tileIndex)
                        startCheckAtIndex = tileIndex
                        return false
                    }
                    const neighbourConnections = connections.get(neighbour)
                    // console.log('neighbour connections', neighbourConnections)
                    if (!neighbourConnections.has(tileIndex)) {
                        // not solved if a connection is not mutual
                        // console.log('not solved for non-mutual connection between tiles', tileIndex, neighbour)
                        startCheckAtIndex = tileIndex
                        return false
                    }
                    if (neighbour!==fromIndex) {
                        if (checked.has(neighbour)) {
                            // it's a loop
                            // console.log('not solved because of loop detected at tile', tileIndex)
                            startCheckAtIndex = tileIndex
                            return false
                        } else {
                            newChecks.add({fromIndex: tileIndex, tileIndex: neighbour})
                        }
                    }
                }
                checked.add(tileIndex)
                toCheck = newChecks
            }
        }
        if (checked.size < grid.total) {
            // console.log('not solved because only', checked.size, 'of', grid.total, 'were reached')
            // it's an island
            return false
        }
        dispatch('solved')
        return true
    }

    onMount(()=>{
        tiles.forEach((tile, index) => {
            let directions = grid.getDirections(tile)
            handleConnections({detail: {
                dirIn: directions,
                dirOut: [],
                tileIndex: index,
            }})
        })
    })
</script>

<svelte:window bind:innerWidth bind:innerHeight />

<div class="puzzle">
    <svg 
        width="{pxPerCell*width}" 
        height="{pxPerCell*height*YSTEP}"
        viewBox="-0.6 {0.5*YSTEP} {width + 1.0} {height*YSTEP}"
        >
        {#each tiles as tile, i (i)}
            <Tile {tile} {i} {grid} {solved} fillColor={solved ? '#7DF9FF' : 'white'}
                on:connections={handleConnections}/>
        {/each}
    </svg>
</div>

<style>
    svg {
        display: block;
        margin: auto;
    }
</style>
