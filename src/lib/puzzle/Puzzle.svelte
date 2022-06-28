<script>
    import { HexaGrid, YSTEP } from "$lib/hexagrid";
    import Tile from '$lib/puzzle/Tile.svelte';
    import { onMount, createEventDispatcher } from 'svelte';
    import {randomColor} from 'randomcolor';

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

    let grid = new HexaGrid(width, height)

    // tile index => set of neighbours that it points to
    let connections = new Map([])

    // tile index => component
    let components = new Map([
       [ -1, {color: 'white', tiles: new Set([])}]
    ])

    const dispatch = createEventDispatcher()

    let pxPerCell = 100
    
    let innerWidth = 500
    let innerHeight = 500
    let initialized = false

    $: pxPerCell = resize(innerWidth, innerHeight)

    function mergeComponents(fromIndex, toIndex) {
        const fromComponent = components.get(fromIndex)
        const toComponent = components.get(toIndex)
        if (fromComponent === toComponent) {
            if (initialized) {
                // console.log('merge component to itself, its a loop')
            }
            return
        }
        const fromIsBigger = fromComponent.tiles.size >= toComponent.tiles.size
        const constantComponent = fromIsBigger ? fromComponent : toComponent
        const changedComponent = fromIsBigger ? toComponent : fromComponent
        for (let changedTile of changedComponent.tiles) {
            components.set(changedTile, constantComponent)
            constantComponent.tiles.add(changedTile)
        }
        if (initialized) {
            let newColor = constantComponent.color
            if (newColor==='white') {
                newColor = changedComponent.color
            }
            if (newColor==='white') {
                newColor = randomColor()
            }
            constantComponent.color = newColor
        }
    }


    function findConnectedTiles(fromIndex, toIndex) {
        let toCheck = new Set([{fromIndex: fromIndex, tileIndex: toIndex}])
        const myComponent = components.get(toIndex)
        const checked = new Set([])
        while (toCheck.size > 0) {
            const newChecks = new Set([])
            for (let{fromIndex, tileIndex} of toCheck) {
                const neighbours = connections.get(tileIndex)
                for (let neighbour of neighbours) {
                    if (neighbour===-1) {
                        // no neighbour
                        continue
                    }
                    if (components.get(neighbour)!==myComponent) {
                        // not from this component, will be handled during merge phase
                        continue
                    }
                    const neighbourConnections = connections.get(neighbour)
                    if (!neighbourConnections.has(tileIndex)) {
                        // not mutual
                        continue
                    }
                    if (neighbour === fromIndex) {
                        // came from here
                        continue
                    }
                    if (checked.has(neighbour)) {
                        // it's a loop?
                        continue
                    }
                    newChecks.add({fromIndex: tileIndex, tileIndex: neighbour})
                }
                checked.add(tileIndex)
                toCheck = newChecks
            }
        }
        return checked
    }

    function disconnectComponents(fromIndex, toIndex) {
        const bigComponent = components.get(fromIndex)
        const fromTiles = findConnectedTiles(toIndex, fromIndex)
        const toTiles = findConnectedTiles(fromIndex, toIndex)
        if ([...fromTiles].some(tile=>toTiles.has(tile))) {
            // it was a loop or maybe it still is
            // console.log('not disconnecting because of other connection')
            return
        }
        const fromIsBigger = fromTiles.size >= toTiles.size
        const leaveTiles = fromIsBigger ? fromTiles : toTiles
        const changeTiles = fromIsBigger ? toTiles : fromTiles
        const newComponent = {
                color: randomColor(),
                tiles: changeTiles,
            }
        
        for (let tileIndex of changeTiles) {
            components.set(tileIndex, newComponent)
            bigComponent.tiles.delete(tileIndex)
        }
        // console.log('created new component', newComponent.id, 'with tiles', [...changeTiles])
    }

    function resize(innerWidth, innerHeight) {
        const wpx = innerWidth / (width + 1.6)
        const hpx = innerHeight / (YSTEP*(height + 0.5))
        return Math.min(100, Math.min(wpx, hpx))
    }

    function handleConnections(event) {
        const {tileIndex, dirIn, dirOut} = event.detail
        // console.log('==========================')
        // console.log(tileIndex, dirIn, dirOut)
        const tileConnections  = connections.get(tileIndex)
        dirOut.forEach(direction => {
            const neighbour = grid.find_neighbour(tileIndex, direction)
            if (neighbour===-1) {return}
            tileConnections.delete(neighbour)
            const neighbourComponent = components.get(neighbour)
            const tileComponent = components.get(tileIndex)
            if (tileComponent===neighbourComponent) {
                // console.log('disconnecting components between tiles', tileIndex, neighbour)
                disconnectComponents(tileIndex, neighbour)
            }
        })
        dirIn.forEach(direction => {
            const neighbour = grid.find_neighbour(tileIndex, direction)
            if (neighbour===-1) {return}
            tileConnections.add(neighbour)
            const neighbourConnections = connections.get(neighbour)
            if (!neighbourConnections.has(tileIndex)) {
                return // non-mutual link shouldn't lead to merging
            }
            const tileComponent = components.get(tileIndex)
            const neighbourComponent = components.get(neighbour)
            if (tileComponent!==neighbourComponent) {
                // console.log('merging components of tiles', tileIndex, neighbour)
                mergeComponents(tileIndex, neighbour)
            }
        })
        if (initialized) {
            solved = isSolved()
        }
        components = components
    }

    function isSolved() {

        // // console.log('=================== Solved check ======================')
        // let toCheck = new Set([{fromIndex: -1, tileIndex: startCheckAtIndex}])
        // console.log('start at', startCheckAtIndex)
        // const checked = new Set([])
        // while (toCheck.size > 0) {
        //     // console.log('toCheck = ', toCheck)
        //     const newChecks = new Set([])
        //     for (let{fromIndex, tileIndex} of toCheck) {
        //         // console.log('checking tile', tileIndex, 'coming from', fromIndex)
        //         const neighbours = connections.get(tileIndex)
        //         // console.log('tile neighbours', neighbours)
        //         for (let neighbour of neighbours) {
        //             // console.log('checking neighbour', neighbour)
        //             if (neighbour===-1) {
        //                 // not solved if any tiles point outside
        //                 // console.log('not solved for outside connection in tile', tileIndex)
        //                 startCheckAtIndex = tileIndex
        //                 return false
        //             }
        //             const neighbourConnections = connections.get(neighbour)
        //             // console.log('neighbour connections', neighbourConnections)
        //             if (!neighbourConnections.has(tileIndex)) {
        //                 // not solved if a connection is not mutual
        //                 // console.log('not solved for non-mutual connection between tiles', tileIndex, neighbour)
        //                 startCheckAtIndex = tileIndex
        //                 return false
        //             }
        //             if (neighbour!==fromIndex) {
        //                 if (checked.has(neighbour)) {
        //                     // it's a loop
        //                     // console.log('not solved because of loop detected at tile', tileIndex)
        //                     startCheckAtIndex = tileIndex
        //                     return false
        //                 } else {
        //                     newChecks.add({fromIndex: tileIndex, tileIndex: neighbour})
        //                 }
        //             }
        //         }
        //         checked.add(tileIndex)
        //         toCheck = newChecks
        //     }
        // }
        // if (checked.size < grid.total) {
        //     // console.log('not solved because only', checked.size, 'of', grid.total, 'were reached')
        //     // it's an island
        //     return false
        // }
        if (components.get(0).tiles.size === grid.total) {
            // there might be loops, so not a sure check
            // works for now I guess?
            // not deleting old code just in case
            dispatch('solved')
            return true
        }
        return false
    }

    function initializeBoard() {
        // create components and fill in connections data
        tiles.forEach((tile, index) => {
            let directions = grid.getDirections(tile)
            connections.set(
                index, 
                new Set(directions.map(direction => {
                return grid.find_neighbour(index, direction)
            })))
            connections.get(index).delete(-1)

            const component = {
                color: 'white',
                tiles: new Set([index])
            }
            components.set(index, component)
        })
        // merge initial components of connected tiles
        tiles.forEach((tile, index) => {
            let directions = grid.getDirections(tile)
            handleConnections({detail: {
                dirIn: directions,
                dirOut: [],
                tileIndex: index,
            }})
        })
        components.delete(-1)
        initialized = true
    }
    onMount(()=>{
        initializeBoard()
    })
</script>

<svelte:window bind:innerWidth bind:innerHeight />

<div class="puzzle">
    <svg 
        width="{pxPerCell*width}" 
        height="{pxPerCell*height*YSTEP}"
        viewBox="-0.6 {0.5*YSTEP} {width + 1.0} {height*YSTEP}"
        on:mousedown|preventDefault={()=>{}}
        on:contextmenu|preventDefault={()=>{}}
        >
        {#each tiles as tile, i (i)}
            <Tile {tile} {i} {grid} {solved} 
                fillColor={solved ? '#7DF9FF' : (components.get(i)||components.get(-1)).color}
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
