<script>
    /** @type {Number} i*/
    export let i;
    export let id;

    /**
     * @type {import('$lib/puzzle/game').PipesGame} game
     */
    export let grid;
</script>

<clipPath id="{id}">
    <path
        d={grid.getClipPath(i)}
    />
</clipPath>