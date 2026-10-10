import { writable } from 'svelte/store';

export const puzzleCounts = writable({
	hexagonal: {
		'5x5': 1000,
		'7x7': 1000,
		'10x10': 1000,
		'15x15': 1000,
		'20x20': 1000,
		'30x30': 1000,
		'40x40': 1000
	},
	hexagonalWrap: {
		'5x5': 1000,
		'7x7': 1000,
		'10x10': 1000,
		'15x15': 1000,
		'20x20': 1000,
		'30x30': 1000,
		'40x40': 1000
	}
});

/**
 * @typedef {'rotate_lock'|'rotate_rotate'|'orient_lock'} ControlMode
 */

/**
 * @typedef {'normal'|'fast'|'instant'} AnimationSpeed
 */

/**
 * @typedef Settings
 * @property {ControlMode} controlMode
 * @property {Boolean} invertRotationDirection
 * @property {Boolean} showTimer
 * @property {Boolean} disableZoomPan
 * @property {Boolean} assistant
 * @property {AnimationSpeed} animationSpeed
 */

function createSettings() {
	let defaultSettings = {
		/** @type {ControlMode} */
		controlMode: 'rotate_lock',
		invertRotationDirection: false,
		showTimer: true,
		disableZoomPan: false,
		assistant: false,
		/** @type {AnimationSpeed} */
		animationSpeed: 'normal'
	};

	const { subscribe, set, update } = writable(defaultSettings);

	/**
	 * @param {Settings} settings
	 */
	function saveToLocalStorage(settings) {
		const data = JSON.stringify(settings);
		try {
			window.localStorage.setItem('settings', data);
		} catch (error) {
			console.log('error while saving settings to local storage');
			console.error(error);
		}
	}

	function loadFromLocalStorage() {
		try {
			const data = window.localStorage.getItem('settings');
			if (data === null) {
				set(defaultSettings);
			} else {
				const parsed = JSON.parse(data);
				// I changed possible control mode values,
				// so I need to update settings if an old one appears
				if (parsed.controlMode === 'click_to_rotate') {
					parsed.controlMode = 'rotate_lock';
				} else if (parsed.controlMode === 'click_to_orient') {
					parsed.controlMode = 'orient_lock';
				}
				const validControlModes = new Set(['rotate_lock', 'rotate_rotate', 'orient_lock']);
				if (!validControlModes.has(parsed.controlMode)) {
					parsed.controlMode = 'rotate_lock';
				}
				set(Object.assign({}, defaultSettings, parsed));
			}
		} catch (error) {
			console.log('error while loading settings from local storage');
			console.error(error);
		}
	}

	/**
	 *
	 * @param {Settings} value
	 */
	function set_(value) {
		set(value);
		saveToLocalStorage(value);
	}

	return {
		subscribe,
		loadFromLocalStorage,
		set: set_
	};
}

export const settings = createSettings();
