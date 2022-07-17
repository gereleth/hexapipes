<script>
    import { settings } from '$lib/stores';
    import { tweened } from 'svelte/motion';
    import { cubicOut } from 'svelte/easing';
    import { createEventDispatcher } from 'svelte';

    /** @type {Number} i*/
    export let i;

    /**
     * @type {import('$lib/puzzle/game').PipesGame} game
     */
    export let game

    export let solved = false
    export let controlMode = 'rotate_lock'
    export let highlightDirections = new Set()

    let state = game.tileStates[i]

    let bgColor = '#aaa'

    const dispatch = createEventDispatcher();

    let rotationAnimate = tweened($state.rotations, {
		duration: 75,
		easing: cubicOut
	})

    let myDirections = game.grid.getDirections($state.tile, $state.rotations)

    const deltas = game.grid.getDirections($state.tile).map(direction => game.grid.XY_DELTAS.get(direction))
    let [cx, cy] = game.grid.index_to_xy(i)
    let angle = findInitialAngle()

    let path = `M ${cx} ${cy}`
    for (let [dx, dy] of deltas) {
        path += ` l ${0.5*dx} ${-0.5*dy} L ${cx} ${cy}`
    }
    const isSink = (myDirections.length === 1)
    
    const hexagon = `M ${cx} ${cy} ` + game.grid.tilePath
    
    let rotationUnit = 1
    $: rotationUnit = $settings.invertRotationDirection ? -1 : 1

    const wrapNeighbours = []
    if (game.grid.wrap) {
        for (let direction of game.grid.DIRECTIONS) {
            const {neighbour, wrapped} = game.grid.find_neighbour(i, direction)
            if (wrapped) {
                wrapNeighbours.push(
                    [i, direction],
                    [neighbour, game.grid.OPPOSITE.get(direction)]
                )
            }
        }
    }
    /**
    * @returns {Number}
    */
    function findInitialAngle() {
        let dx = 0, dy=0
        for (let [deltax, deltay] of deltas) {
            dx += deltax
            dy += deltay
        }
        dx /= myDirections.length
        dy /= myDirections.length
        if ((Math.abs(dx) < 0.001)&&(Math.abs(dy) < 0.001)) {
            dx = deltas[0][0]
            dy = deltas[0][1]
        }
        return Math.atan2(dy, dx)
    }

    /**
    * @param {MouseEvent} event
    */
    function onClick(event) {
        if (controlMode === 'rotate_lock') {
            if (event.ctrlKey) {
                rotate(-rotationUnit)
            } else {
                rotate(rotationUnit)
            }
        } else if (controlMode === 'rotate_rotate') {
            if (event.ctrlKey) {
                state.locked = !state.locked
            } else {
                rotate(rotationUnit)
            }
        } else if (controlMode === 'orient_lock') {
            const element = event.target.closest('.tile')
            const {x, width, y, height} = element.getBoundingClientRect()
            const dx = event.clientX - x - width/2
            const dy = height/2 - (event.clientY - y)
            const newAngle = Math.atan2(dy, dx)
            const newRotations = Math.round((angle - newAngle)*3/Math.PI)
            let timesRotate = newRotations - ($state.rotations%6)
            if (timesRotate < -3.5) {timesRotate += 6}
            else if (timesRotate > 3.5) {timesRotate -=6}
            rotate(timesRotate)
        }
    }


    function onContextMenu() {
        if (controlMode === 'rotate_lock') {
            state.toggleLocked()
        } else if (controlMode === 'rotate_rotate') {
            rotate(-rotationUnit)
        } else if (controlMode === 'orient_lock') {
            state.toggleLocked()
        }
    }
    /**
    * @param {Number} times
    */
    function rotate(times) {
        if ($state.locked||solved) {return}
        state.setRotations($state.rotations + times)
        const newDirections = game.grid.getDirections($state.tile, $state.rotations)

        rotationAnimate.set($state.rotations)

        const dirOut = myDirections.filter(direction => !(newDirections.some(d=>d===direction)))
        const dirIn = newDirections.filter(direction => !(myDirections.some(d=>d===direction)))
        dispatch('connections', {
            tileIndex: i,
            dirOut: dirOut,
            dirIn: dirIn,
            from: 'user',
        })
        myDirections = newDirections
    }

    function chooseBgColor() {
        if ($state.isPartOfLoop) {
            bgColor = $state.locked ? '#f99' : '#fbb'
        } else {
            bgColor = $state.locked ? '#bbb' : '#ddd'
        }
    }

    function highlightWrapNeighbours() {
        if (wrapNeighbours.length > 0) {
            dispatch('highlightWrap', wrapNeighbours)
        }
    }

    function getHighlightLines(highlightDirections) {
        const lines = []
        const length = 0.04
        for (let direction of highlightDirections) {
            const [lx, ly] = grid.XY_DELTAS.get(direction)
            lines.push({
                x1: cx + (0.5-length)*lx,
                x2: cx + (0.5+length)*lx,
                y1: cy - (0.5-length)*ly,
                y2: cy - (0.5+length)*ly,
            })

        }
        return lines
    }

    $: chooseBgColor($state.locked, $state.isPartOfLoop)

    $: $state.locked, dispatch('toggleLocked')
</script>

<g class='tile'
    on:click={onClick}
    on:contextmenu|preventDefault={onContextMenu}
    on:mouseenter={highlightWrapNeighbours}
>
<!-- Tile hexagon -->
<path d={hexagon} stroke="#aaa" stroke-width="0.02" fill="{bgColor}" />

<!-- Pipe shape -->
<g transform="rotate({60*$rotationAnimate}, {cx}, {cy})">
    <!-- Pipe outline -->
    <path 
        d={path} 
        stroke="#888" 
        stroke-width="0.20"    
        stroke-linejoin="bevel" 
        stroke-linecap="round"
        >
    </path>
    <!-- Sink circle -->
    {#if isSink}
        <circle {cx} {cy} r="0.15" fill={$state.color} stroke="#888" stroke-width="0.05" class='inside'/>
    {/if}
    <!-- Pipe inside -->
    <path class='inside'
        d={path} 
        stroke={$state.color} 
        stroke-width="0.10" 
        stroke-linejoin="round" 
        stroke-linecap="round"
        >
    </path>
    {#if (controlMode==="orient_lock")&&(!$state.locked)&&(!solved)}
        <!-- Guide dot -->
        <circle 
            cx={cx + 0.4*Math.cos(angle)} 
            cy={cy-0.4*Math.sin(angle)} 
            fill='orange' 
            stroke='white' 
            r='0.03' 
            stroke-width="0.01" 
            />
    {/if}
</g>

{#each getHighlightLines(highlightDirections) as line}
<line 
    class='wrap'
    {...line}
    stroke="#777"
    stroke-width="0.3" />
{/each}

</g>

<style>
    .tile {
        transform-origin: center;
        transform-box: fill-box;
        transition: transform 100ms;
    }
</style>