<script>
    import { DIRECTIONS, XY_DELTAS, YSTEP } from '$lib/hexagrid';
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

    const dispatch = createEventDispatcher();

    let rotationAnimate = tweened(rotations, {
		duration: 75,
		easing: cubicOut
	})

    let myDirections = grid.getDirections(tile)
    const deltas = myDirections.map(direction => XY_DELTAS.get(direction))
    let [cx, cy] = grid.index_to_xy(i)
    cy = grid.height*YSTEP - cy
    let path = `M ${cx} ${cy}`
    for (let [dx, dy] of deltas) {
        path += ` l ${0.5*dx} ${-0.5*dy} L ${cx} ${cy}`
    }
    const isSink = (myDirections.length === 1)
    
    const hexagon = `M ${cx} ${cy} ` + grid.tilePath
    
    /**
    * @param {MouseEvent} event
    */
    function onClick(event) {
        if (locked) {return}
        // const {x, width} = event.target.getBoundingClientRect()
        rotate(!event.ctrlKey)        
    }
    /**
    * @param {clockwise} boolean
    */
    function rotate(clockwise=true) {
        let newDirections = []
        if (clockwise) {
            rotations -= 1

            newDirections = myDirections.map(direction => {
                const newDirection = Math.floor(direction / 2)
                return newDirection == 0 ? 32 : newDirection
            })
        } else {
            rotations += 1

            newDirections = myDirections.map(direction => {
                const newDirection = direction * 2
                return newDirection == 64 ? 1 : newDirection
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
</script>

<!-- Tile hexagon -->
<path d={hexagon} stroke="#aaa" stroke-width="0.02" fill="{locked ? '#bbb' : '#ddd'}" />

<!-- Pipe shape -->
<g transform="rotate({-60*$rotationAnimate}, {cx}, {cy})">
    <!-- Pipe outline -->
    <path 
        d={path} 
        stroke="#888" 
        stroke-width="0.14"    
        stroke-linejoin="bevel" 
        stroke-linecap="round"
        >
    </path>
    <!-- Sink circle -->
    {#if isSink}
        <circle {cx} {cy} r="0.12" fill={fillColor} stroke="#888" stroke-width="0.03"/>
    {/if}
    <!-- Pipe inside -->
    <path 
        d={path} 
        stroke={fillColor} 
        stroke-width="0.08" 
        stroke-linejoin="round" 
        stroke-linecap="round"
        >
    </path>
</g>
{#if !solved}
    <!-- Invisible circle for clicking to rotate -->
    <path d={hexagon} fill="rgba(1,1,1,0.0)" 
        on:click={onClick}
        on:contextmenu|stopPropagation|preventDefault={()=> locked = !locked}
    />
{/if}