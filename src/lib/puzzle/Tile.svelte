<script>
    import { XY_DELTAS, YSTEP } from '$lib/hexagrid';
    import { tweened } from 'svelte/motion';
    import { cubicOut } from 'svelte/easing';
    import { createEventDispatcher } from 'svelte';

    export let i;
    export let tile;
    export let grid;
    export let locked = false
    export let rotations = 0
    export let fillColor = 'white'
    export let solved = false
    export let controlMode = 'rotate_lock'
    export let isPartOfLoop = false
    let bgColor = '#aaa'

    const dispatch = createEventDispatcher();

    let rotationAnimate = tweened(rotations, {
		duration: 75,
		easing: cubicOut
	})

    let myDirections = grid.getDirections(tile, rotations)

    const deltas = grid.getDirections(tile).map(direction => XY_DELTAS.get(direction))
    let [cx, cy] = grid.index_to_xy(i)
    cy = grid.height*YSTEP - cy
    let angle = findInitialAngle()

    let path = `M ${cx} ${cy}`
    for (let [dx, dy] of deltas) {
        path += ` l ${0.5*dx} ${-0.5*dy} L ${cx} ${cy}`
    }
    const isSink = (myDirections.length === 1)
    
    const hexagon = `M ${cx} ${cy} ` + grid.tilePath
    
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
                rotate(-1)
            } else {
                rotate(1)
            }
        } else if (controlMode === 'rotate_rotate') {
            if (event.ctrlKey) {
                locked = !locked
            } else {
                rotate(1)
            }
        } else if (controlMode === 'orient_lock') {
            const element = event.target.closest('.tile')
            const {x, width, y, height} = element.getBoundingClientRect()
            const dx = event.clientX - x - width/2
            const dy = height/2 - (event.clientY - y)
            const newAngle = Math.atan2(dy, dx)
            const newRotations = Math.round((angle - newAngle)*3/Math.PI)
            let timesRotate = newRotations - (rotations%6)
            if (timesRotate < -3.5) {timesRotate += 6}
            else if (timesRotate > 3.5) {timesRotate -=6}
            rotate(timesRotate)
        }
    }


    function onContextMenu() {
        if (controlMode === 'rotate_lock') {
            locked = !locked
        } else if (controlMode === 'rotate_rotate') {
            rotate(-1)
        } else if (controlMode === 'orient_lock') {
            locked = !locked
        }
    }
    /**
    * @param {Number} times
    */
    function rotate(times) {
        if (locked||solved) {return}
        rotations = rotations + times
        const newDirections = grid.getDirections(tile, rotations)

        rotationAnimate.set(rotations)

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
        if (isPartOfLoop) {
            bgColor = locked ? '#f99' : '#fbb'
        } else {
            bgColor = locked ? '#bbb' : '#ddd'
        }
    }

    $: chooseBgColor(locked, isPartOfLoop)

    $: locked, dispatch('toggleLocked')
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
        <circle {cx} {cy} r="0.15" fill={fillColor} stroke="#888" stroke-width="0.05" class='inside'/>
    {/if}
    <!-- Pipe inside -->
    <path class='inside'
        d={path} 
        stroke={fillColor} 
        stroke-width="0.10" 
        stroke-linejoin="round" 
        stroke-linecap="round"
        >
    </path>
    {#if (controlMode==="orient_lock")&&(!locked)&&(!solved)}
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

<style>
    .tile {
        transform-origin: center;
        transform-box: fill-box;
        transition: transform 100ms;
    }
</style>