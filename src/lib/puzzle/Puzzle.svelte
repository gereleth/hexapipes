<script>
    import { browser } from '$app/env'
    import { DIRECTIONS, HexaGrid, YSTEP } from "$lib/hexagrid";
    import { settings } from '$lib/stores';
    import Tile from '$lib/puzzle/Tile.svelte';
    import EdgeMark from '$lib/puzzle/EdgeMark.svelte';
    import { onMount, createEventDispatcher } from 'svelte';
    import {randomColor} from 'randomcolor';

    export let width = 0
    export let height = 0
    /** @type {Number[]} */
    export let tiles = [
    ]
    let solved = false

    let grid = new HexaGrid(width, height)

    // tile index => set of neighbours that it points to
    let connections = new Map([])

    // tile index => component
    let components = new Map([
       [ -1, {color: 'white', tiles: new Set([-1])}]
    ])
    let displayTiles = tiles.map((tile, index) => { 
        return {
            tile: tile,
            color: 'white',
            isPartOfLoop: false,
        }
    })
    const dispatch = createEventDispatcher()

    let pxPerCell = 100
    
    let innerWidth = 500
    let innerHeight = 500
    let initialized = false

    let edgeMarks = []
    for (let i=0; i<grid.total; i++) {
        const [x, y] = grid.index_to_xy(i)
        for (let direction of DIRECTIONS) {
            const neighbour = grid.find_neighbour(i, direction)
            if (neighbour > i) {
                const [nx, ny] = grid.index_to_xy(neighbour)
                edgeMarks.push({
                    x: (x+nx)/2,
                    y: (grid.height)*YSTEP -(y+ny)/2,
                    direction: direction,
                    state: 'none',
                })
            }
        }
    }
    /**
     * @param {Number} fromIndex
     * @param {Number} toIndex
     * @returns {void}
     */
    function mergeComponents(fromIndex, toIndex) {
        const fromComponent = components.get(fromIndex)
        const toComponent = components.get(toIndex)
        // makes jsdoc stop complaining about
        // "object is possibly undefined"
        if ((fromComponent===undefined)||(toComponent===undefined)) {
            // console.log('could not find component for tile')
            return
        }
        if (fromComponent === toComponent) {
            // console.log('merge component to itself, its a loop', fromIndex, toIndex)
            const loopTiles = detectLoops(fromComponent.tiles)
            for (let tile of fromComponent.tiles) {
                displayTiles[tile].isPartOfLoop = loopTiles.has(tile)
            }
            return
        }
        const fromIsBigger = fromComponent.tiles.size >= toComponent.tiles.size
        const constantComponent = fromIsBigger ? fromComponent : toComponent
        const changedComponent = fromIsBigger ? toComponent : fromComponent
        if (initialized) {
            let newColor = constantComponent.color
            if (newColor==='white') {
                newColor = changedComponent.color
            }
            if (newColor==='white') {
                newColor = randomColor({luminosity: 'light'})
            }
            if (constantComponent.color !== newColor) {
                constantComponent.tiles.forEach(tileIndex => {
                    displayTiles[tileIndex].color = newColor
                })
            }
            constantComponent.color = newColor
        }
        for (let changedTile of changedComponent.tiles) {
            components.set(changedTile, constantComponent)
            constantComponent.tiles.add(changedTile)
            displayTiles[changedTile].color = constantComponent.color
        }
    }

    /**
     * @param {Number} fromIndex
     * @param {Number} toIndex
     * @returns {Set<Number>}
     */
    function findConnectedTiles(fromIndex, toIndex) {
        let tileToCheck = new Set([{fromIndex: fromIndex, tileIndex: toIndex}])
        const myComponent = components.get(toIndex)
        /** @type {Set<Number>} */
        const checked = new Set([])
        while (tileToCheck.size > 0) {
            /** @type {Set<{fromIndex: Number, tileIndex: Number}>} */
            const newChecks = new Set([])
            for (let{fromIndex, tileIndex} of tileToCheck) {
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
                tileToCheck = newChecks
            }
        }
        return checked
    }

    /**
     * @param {Number} fromIndex
     * @param {Number} toIndex
     * @returns {void}
     */
    function disconnectComponents(fromIndex, toIndex) {
        const bigComponent = components.get(fromIndex)
        if (bigComponent===undefined) {return} // this shouldn't really happen, jsdoc
        const fromTiles = findConnectedTiles(toIndex, fromIndex)
        const toTiles = findConnectedTiles(fromIndex, toIndex)
        if ([...fromTiles].some(tile=>toTiles.has(tile))) {
            // it was a loop or maybe it still is
            // console.log('not disconnecting because of other connection', fromIndex, toIndex)
            const loopTiles = detectLoops(bigComponent.tiles)
            for (let tile of bigComponent.tiles) {
                displayTiles[tile].isPartOfLoop = loopTiles.has(tile)
            }
            return
        }
        const fromIsBigger = fromTiles.size >= toTiles.size
        // const leaveTiles = fromIsBigger ? fromTiles : toTiles
        const changeTiles = fromIsBigger ? toTiles : fromTiles
        const newComponent = {
                color: randomColor({luminosity: 'light'}),
                tiles: changeTiles,
            }
        
        for (let tileIndex of changeTiles) {
            components.set(tileIndex, newComponent)
            bigComponent.tiles.delete(tileIndex)
            displayTiles[tileIndex].color = newComponent.color
        }
        // console.log('created new component', newComponent.id, 'with tiles', [...changeTiles])
    }

    /**
     * @param {Number} innerWidth
     * @param {Number} innerHeight
     * @returns {Number}
     */
    function resize(innerWidth, innerHeight) {
        const wpx = innerWidth / (width + 1.6)
        const hpx = innerHeight / (YSTEP*(height + 0.5))
        return Math.min(100, Math.min(wpx, hpx))
    }

    /**
     * @param {{detail: {
     *  tileIndex: Number,
     *  dirIn: Number[],
     *  dirOut: Number[],
     * }}} event
     * @returns {void}
     */
    function handleConnections(event) {
        const {tileIndex, dirIn, dirOut} = event.detail
        // console.log('==========================')
        // console.log(tileIndex, dirIn, dirOut)
        const tileConnections  = connections.get(tileIndex)
        dirOut.forEach(direction => {
            const neighbour = grid.find_neighbour(tileIndex, direction)
            if (neighbour===-1) {return}
            tileConnections.delete(neighbour)
            const neighbourConnections = connections.get(neighbour)
            if (!neighbourConnections.has(tileIndex)) {
                return // this connection wasn't mutual, no action needed
            }
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
            // console.log('merging components of tiles', tileIndex, neighbour)
            mergeComponents(tileIndex, neighbour)
        })
        if (initialized) {
            solved = isSolved()
        }
    }

    /**
     * @returns {boolean}
     */
    function isSolved() {
        // console.log('=================== Solved check ======================')
        const component = components.get(0)
        if (component===undefined) {return false}
        if (component.tiles.size < grid.total) {
            // console.log('not everything connected yet')
            // not everything connected yet
            return false
        }
        let startCheckAtIndex = 0
        let toCheck = new Set([{fromIndex: -1, tileIndex: startCheckAtIndex}])
        // console.log('start at', startCheckAtIndex)
        /** @type Set<Number> */
        const checked = new Set([])
        while (toCheck.size > 0) {
            // console.log('toCheck = ', toCheck)
            /** @type {Set<{fromIndex: Number, tileIndex: Number}>} */
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

    
    /**
     * @param {Set<Number>} tilesSet
     * @returns {Set<Number>}
     */
    function detectLoops(tilesSet) {
        // console.log('detect loops in set', tilesSet)
        const myConnections = new Map()
        let toPrune = new Set()
        for (let tile of tilesSet) {
            const tileConnections = connections.get(tile)
            const inComponent = new Set(
                [...tileConnections]
                .filter(x=>(tilesSet.has(x))&&(connections.get(x).has(tile))
            ))
            myConnections.set(tile, inComponent)
            if (inComponent.size === 1) {
                toPrune.add(tile)
            }
        }

        function pruneTile(tile) {
            const neighbours = myConnections.get(tile)
            if (neighbours.size <= 1) {
                myConnections.delete(tile)
                neighbours.forEach(neighbour => {
                    myConnections.get(neighbour).delete(tile)
                })
                return neighbours
            }
            return new Set()
        }

        function pruneDeadEnds() {
            while (toPrune.size > 0) {
                const tile = toPrune.values().next().value
                toPrune.delete(tile)
                const changedNeighbours = pruneTile(tile)
                changedNeighbours.forEach(n => toPrune.add(n))
            }
        }
        pruneDeadEnds()
        // at this point we have all the loops but maybe also
        // some bridges between loops
        // need to prune them too
        const inLoops = new Set()

        function traceLoopPath(fromTile, throughTile) {
            let paths = [[fromTile, throughTile]]
            while (paths.length > 0) {
                const path = paths.pop()
                const lastTile = path[path.length - 1]
                const neighbours = myConnections.get(lastTile)
                for (let neighbour of neighbours) {
                    if (neighbour === fromTile) {
                        if (path.length>2) {
                            // successful loop
                            return path
                        } else {
                            continue
                        }
                    }
                    if (path.slice(1).some(x=>x===neighbour)) {
                        // already been here
                        continue
                    }
                    paths.push([...path, neighbour])
                }
            }
            return []
        }
        while (inLoops.size < myConnections.size) {
            // console.log('myconnections', myConnections.size, ', in loops', inLoops.size)
            let tileToCheck = -1
            for (let tile of myConnections.keys()) {
                if (!inLoops.has(tile)) {
                    tileToCheck = tile
                    break
                }
            }
            // console.log('checking tile', tileToCheck)
            const neighbour = myConnections.get(tileToCheck).values().next().value
            // console.log('checking neighbour', neighbour)
            const loop = traceLoopPath(tileToCheck, neighbour)
            // console.log('found loop', loop)
            if (loop.length === 0) {
                // no loop found
                myConnections.get(tileToCheck).delete(neighbour)
                myConnections.get(neighbour).delete(tileToCheck)
                toPrune.add(neighbour).add(tileToCheck)
                pruneDeadEnds()
            } else {
                loop.forEach(i=>inLoops.add(i))
            }
        }
        return inLoops
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
        pxPerCell = resize(innerWidth, innerHeight)
    })

    let isTouching = false
    $: if (browser) document.body.classList.toggle('no-selection', isTouching);
</script>

<svelte:window bind:innerWidth bind:innerHeight />

<div class="puzzle">
    <svg 
        width="{pxPerCell*width}" 
        height="{pxPerCell*height*YSTEP}"
        viewBox="-0.6 {0.5*YSTEP} {width + 1.0} {height*YSTEP}"
        on:mousedown|preventDefault={()=>{}}
        on:contextmenu|preventDefault={()=>{}}
        on:touchstart={()=>isTouching=true}
        on:touchend={()=>isTouching=false}
        >
        {#each displayTiles as displayTile, i (i)}
            <Tile tile={displayTile.tile} {i} {grid} {solved}
                isPartOfLoop={displayTile.isPartOfLoop}
                controlMode={$settings.controlMode}
                fillColor={solved ? '#7DF9FF' : displayTile.color}
                on:connections={handleConnections}/>
        {/each}
        {#if !solved}
            {#each edgeMarks as mark}
                <EdgeMark 
                    x={mark.x} 
                    y={mark.y} 
                    state={mark.state} 
                    direction={mark.direction}
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
</style>
