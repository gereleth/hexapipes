<script>
    import EdgeMark from '$lib/puzzle/EdgeMark.svelte'
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
    export let cx = 0
    export let cy = 0
    export let solved = false
    export let controlMode = 'rotate_lock'

    let state = game.tileStates[i]

    let bgColor = '#aaa'

    const dispatch = createEventDispatcher();

    let rotationAnimate = tweened($state.rotations, {
		duration: 75,
		easing: cubicOut
	})

    const myDirections = game.grid.getDirections($state.tile)

    const deltas = myDirections.map(direction => game.grid.XY_DELTAS.get(direction))
    let angle = findInitialAngle()

    let path = `M ${cx} ${cy}`
    for (let [dx, dy] of deltas) {
        path += ` l ${0.5*dx} ${-0.5*dy} L ${cx} ${cy}`
    }
    const isSink = (myDirections.length === 1)
    
    const hexagon = `M ${cx} ${cy} ` + game.grid.tilePath
    
    let rotationUnit = 1
    $: rotationUnit = $settings.invertRotationDirection ? -1 : 1

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
                toggleLocked()
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
            toggleLocked()
        } else if (controlMode === 'rotate_rotate') {
            rotate(-rotationUnit)
        } else if (controlMode === 'orient_lock') {
            toggleLocked()
        }
    }
    /**
    * @param {Number} times
    */
    function rotate(times) {
        if ($state.locked||solved) {return}
        // this tile might be rotated in another component if it's a wrap puzzle
        // so safer to always calculate directions from state
        const myDirections = game.grid.getDirections($state.tile, $state.rotations)
        $state.rotations += times
        const newDirections = game.grid.getDirections($state.tile, $state.rotations)

        const dirOut = myDirections.filter(direction => !(newDirections.some(d=>d===direction)))
        const dirIn = newDirections.filter(direction => !(myDirections.some(d=>d===direction)))
        dispatch('connections', {
            tileIndex: i,
            dirOut: dirOut,
            dirIn: dirIn,
        })
        dispatch('save')
    }

    function toggleLocked() {
        state.toggleLocked()
        dispatch('save')
    }

    /**
     * Choose tile background color
     * @param {Boolean} locked
     * @param {Boolean} isPartOfLoop
     */
    function chooseBgColor(locked, isPartOfLoop) {
        if (isPartOfLoop) {
            bgColor = locked ? '#f99' : '#fbb'
        } else {
            bgColor = locked ? '#bbb' : '#ddd'
        }
    }

    $: chooseBgColor($state.locked, $state.isPartOfLoop)

    // want to animate even if rotation is from another wrap tile
    $: rotationAnimate.set($state.rotations)
</script>

<g class='tile'
    on:click={onClick}
    on:contextmenu|preventDefault={onContextMenu}
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
</g>

{#if !solved}
    {#each $state.edgeMarks as _, index (index)}
        <EdgeMark 
            grid={game.grid}
            cx={cx} 
            cy={cy} 
            bind:state={$state.edgeMarks[index]} 
            direction={game.grid.EDGEMARK_DIRECTIONS[index]}
            on:save
            />
    {/each}
{/if}

<style>
    .tile {
        transform-origin: center;
        transform-box: fill-box;
        transition: transform 100ms;
    }
</style>