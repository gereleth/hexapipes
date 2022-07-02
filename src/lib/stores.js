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