// this counts how many puzzles of each size we actually have

export async function get() {
	const pathStart = `/static/_instances/hexagonal/`
	const instances = import.meta.glob(`/static/_instances/hexagonal/**/*.json`)
	let totalPuzzles = new Map([])
	for (let [path, _] of Object.entries(instances)) {
        const sizePart = path.split('/')[4] // str like "5x5"
        if (!totalPuzzles.has(sizePart)) {
            totalPuzzles.set(sizePart, 0)
        }
        totalPuzzles.set(sizePart, totalPuzzles.get(sizePart) + 1)
	}
	
    return {
        body: {
            totalPuzzles: Object.fromEntries(totalPuzzles),
        }
    };
}
