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
    export let controlMode = 'click_to_rotate'
    export let isPartOfLoop = false
    let bgColor = '#aaa'

    const dispatch = createEventDispatcher();

    let rotationAnimate = tweened(rotations, {
		duration: 75,
		easing: cubicOut
	})

    let myDirections = grid.getDirections(tile)
    const deltas = myDirections.map(direction => XY_DELTAS.get(direction))
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
        if (locked||solved) {return}
        if (controlMode === 'click_to_rotate') {
            if (event.ctrlKey) {
                rotate(-1)
            } else {
                rotate(1)
            }
        } else if (controlMode === 'click_to_orient') {
            const element = event.target.closest('.tile')
            const {x, width, y, height} = element.getBoundingClientRect()
            const dx = event.clientX - x - width/2
            const dy = height/2 - (event.clientY - y)
            const newAngle = Math.atan2(dy, dx)
            const deltaAngle = newAngle - angle
            const newRotations = Math.round(deltaAngle*3/Math.PI)
            let timesRotate = newRotations - rotations
            if (timesRotate < -3.5) {timesRotate += 6}
            else if (timesRotate > 3.5) {timesRotate -=6}
            rotate(-timesRotate)
        }
    }
    /**
    * @param {Number} times
    */
    function rotate(times) {
        let newDirections = [...myDirections]
        while (times < -0.1) {
            rotations += 1
            times += 1
            newDirections = newDirections.map(direction => {
                const newDirection = direction * 2
                return newDirection == 64 ? 1 : newDirection
            })
        }
        while (times > 0.1) {
            rotations -= 1
            times -= 1
            newDirections = newDirections.map(direction => {
                const newDirection = Math.floor(direction / 2)
                return newDirection == 0 ? 32 : newDirection
            })
        }
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
            bgColor = locked ? '#f77' : '#f99'
        } else {
            bgColor = locked ? '#bbb' : '#ddd'
        }
    }

    $: chooseBgColor(locked, isPartOfLoop)
</script>

<g class='tile'
    on:click={onClick}
    on:contextmenu|preventDefault={()=>locked=!locked} 
>
<!-- Tile hexagon -->
<path d={hexagon} stroke="#aaa" stroke-width="0.02" fill="{bgColor}" />

<!-- Pipe shape -->
<g transform="rotate({-60*$rotationAnimate}, {cx}, {cy})">
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
        <circle {cx} {cy} r="0.15" fill={fillColor} stroke="#777" stroke-width="0.05"/>
    {/if}
    <!-- Pipe inside -->
    <path 
        d={path} 
        stroke={fillColor} 
        stroke-width="0.10" 
        stroke-linejoin="round" 
        stroke-linecap="round"
        >
    </path>
    {#if (controlMode==="click_to_orient")&&(!locked)&&(!solved)}
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