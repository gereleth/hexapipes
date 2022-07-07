import {writable} from 'svelte/store'

export const puzzleCounts = writable({})

function createSettings() {

    let defaultSettings = {
        controlMode: 'click_to_rotate',
    }

	const { subscribe, set, update } = writable(defaultSettings);

    function saveToLocalStorage(settings) {
        const data = JSON.stringify(settings)
        try {
            window.localStorage.setItem('settings', data)   
        } catch (error) {
            console.log('error while saving settings to local storage')
            console.error(error)
        }
    }

    function loadFromLocalStorage() {
        try {
            const data = window.localStorage.getItem('settings')
            if (data===null) {
                set(defaultSettings)
            } else {
                const parsed = JSON.parse(data)
                set(parsed)
            }
        } catch (error) {
            console.log('error while loading settings from local storage')
            console.error(error)
        }
    }

    function set_(value) {
        set(value)
        saveToLocalStorage(value)
    }

	return {
		subscribe,
        loadFromLocalStorage,
		set: set_,
	};
}

export const settings = createSettings()


function createSolvesStore(name) {
    // console.log('creating store for', path)

    let data = []
    const saved = window.localStorage.getItem(name)
    if (saved!==null) {
        data = JSON.parse(saved)
    }

    const { subscribe, set, update } = writable(data);

    subscribe(solves => {
        // console.log('solves changed:', storeName)
        // console.log(solves)
        const saved = JSON.stringify(solves)
        window.localStorage.setItem(name, saved)
        data = solves
    })

    window.addEventListener('storage', function(e) {
        // in case something is solved in another tab?
        if (e.key === name) {
            const saved = e.newValue
            if (saved===null) {
                data = []
            } else {
                data = JSON.parse(saved)
            }
            set(data)
        }
    });
      

    function reportStart(puzzleId) {
        let solve
        update(solves => {
            // find if we solved this already
            solve = solves.find(solve => 
                (solve.puzzleId===puzzleId)&&(solve.elapsedTime!==-1)
            )
            // TODO find if we have saved progress on this one

            // If not - then start a fresh solve
            if (solve===undefined) {
                solve = {
                    puzzleId,
                    startedAt: (new Date()).valueOf(),
                    finishedAt: -1,
                    elapsedTime: -1,
                }
                solves.unshift(solve)
            }
            return solves
        })
        return solve
    }

    function reportFinish(puzzleId) {
        const finishedAt = (new Date()).valueOf()
        let solve
        update(solves => {
            if (solves.length===0) {
                solve = {
                    puzzleId,
                    startedAt: -1,
                    finishedAt: -1,
                    elapsedTime: -1,
                    error: 'No started puzzles found, so the finish could not be recorded'
                }
                return solves
            }
            // find if we solved this already
            solve = solves.find(solve => 
                (solve.puzzleId===puzzleId)&&(solve.elapsedTime!==-1)
            )
            if (solve !== undefined) {
                return solves
            }
            // check if this puzzle was the last one started
            if (solves[0].puzzleId !== puzzleId) {
                solve = {
                    puzzleId,
                    startedAt: -1,
                    finishedAt: -1,
                    elapsedTime: -1,
                    error: 'Another puzzle was started after this one, so the finish could not be recorded'
                }
                return solves
            }
            solve = solves[0]
            // finally record elapsed time
            solve.finishedAt = finishedAt
            solve.elapsedTime = finishedAt - solve.startedAt
            return solves
        })
        return solve
    }

    return {
        subscribe,
        reportStart,
        reportFinish,
    }
}

const solvesStores = new Map()

export function getSolves(path) {
    // path is like /<category>/<size>/<puzzle id>
    // this takes the category and size parts only
    const storeName = path.split('/', 3).join('/') + '_solves'
    if (solvesStores.has(storeName)) {
        return solvesStores.get(storeName)
    } else {
        let store = createSolvesStore(storeName)
        solvesStores.set(storeName, store)
        return store
    }
}