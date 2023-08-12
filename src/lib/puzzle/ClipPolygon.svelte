<script>
    /** @type {Number} i*/
    export let i;

    /**
     * @type {import('$lib/puzzle/game').PipesGame} game
     */
    export let game;
    export let cx = 0;
    export let cy = 0;
</script>

<clipPath id="clip-path-{i}">
    <path
        d={game.grid.getClipPath(i)}
    />
</clipPath>