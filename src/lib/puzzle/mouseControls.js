import { settings } from '$lib/stores';
import normalizeWheel from 'normalize-wheel';

/**
 * Attaches mouse controls to the game area
 * @param {HTMLElement} node
 * @param {import('$lib/puzzle/game').PipesGame} game
 * @returns
 */
export function mouseControls(node, game) {
	const grid = game.grid;

	/**
	 * @type {import('./hexagrid').ViewBox}
	 */
	let viewBox;

	const unsubscribeViewBox = grid.viewBox.subscribe((box) => {
		viewBox = box;
	});

	/**
	 * @type {import('$lib/stores').Settings}
	 */
	let currentSettings;
	const unsubscribeSettings = settings.subscribe((s) => {
		currentSettings = s;
	});

	const rect = node.getBoundingClientRect()
	const pixelsWidth = rect.width
	const pixelsHeight = rect.height

	/**
	 * @type {'idle'|'mousedown'|'panning'|'locking'|'unlocking'}
	 */
	let state = 'idle';

	let mouseDownOrigin = {
		x: 0,
		y: 0,
		button: 0,
		tileIndex: 0,
		tileX: 0,
		tileY: 0
	};

	/**
	 * @type {Set<Number>}
	 */
	let lockingSet = new Set();

	/**
	 * Compute X and Y coordinates of the event in game grid units
	 * @param {MouseEvent} event
	 * @returns {Number[]}
	 */
	function getEventCoordinates(event) {
		const { x, y, width, height } = node.getBoundingClientRect();
		const relativeX = (event.clientX - x) / width;
		const relativeY = (event.clientY - y) / height;
		const gameX = viewBox.xmin + relativeX * viewBox.width;
		const gameY = viewBox.ymin + relativeY * viewBox.height;
		return [gameX, gameY];
	}

	function save() {
		node.dispatchEvent(
			new CustomEvent('save')
		);
	}

	/**
	 *
	 * @param {MouseEvent} event
	 */
	function handleMouseDown(event) {
		const target = event.target;

		const [x, y] = getEventCoordinates(event);

		mouseDownOrigin = {
			x,
			y,
			button: event.button,
			tileIndex: -1,
			tileX: 0,
			tileY: 0
		};

		const maybeTile = target.closest('g.tile');
		if (maybeTile) {
			mouseDownOrigin.tileIndex = Number(maybeTile.getAttribute('data-index'));
			mouseDownOrigin.tileX = Number(maybeTile.getAttribute('data-x'));
			mouseDownOrigin.tileY = Number(maybeTile.getAttribute('data-y'));
		}

		if (mouseDownOrigin.tileIndex === -1) {
			state = 'panning';
		} else {
			const locking =
				(currentSettings.controlMode === 'rotate_lock' && event.button === 2) ||
				(currentSettings.controlMode === 'rotate_rotate' && event.button === 0 && event.ctrlKey) ||
				(currentSettings.controlMode === 'orient_lock' && event.button === 2);
			if (locking) {
				lockingSet.add(mouseDownOrigin.tileIndex);
				const tileState = game.tileStates[mouseDownOrigin.tileIndex];
				tileState.toggleLocked();
				state = tileState.data.locked ? 'locking' : 'unlocking';
				save()
			} else {
				state = 'mousedown';
			}
		}
	}

	/**
	 *
	 * @param {MouseEvent} event
	 */
	function handleMouseMove(event) {
		if (state === 'idle') {
			return;
		}
		event.preventDefault();
		const [x, y] = getEventCoordinates(event);
		const dx = x - mouseDownOrigin.x;
		const dy = y - mouseDownOrigin.y;
		const distance = Math.sqrt(dx * dx + dy * dy);
		if (state === 'mousedown') {
			if (distance >= 1) {
				if (mouseDownOrigin.button === 0) {
					state = 'panning';
				}
			}
		}
		if (state === 'panning') {
			grid.pan(dx, dy);
		} else if (state === 'locking' || state === 'unlocking') {
			const maybeTile = event.target.closest('g.tile');
			if (maybeTile) {
				const tileIndex = Number(maybeTile.getAttribute('data-index'));
				if (!lockingSet.has(tileIndex)) {
					lockingSet.add(tileIndex);
					const tileState = game.tileStates[tileIndex];
					tileState.data.locked = state === 'locking' ? true : false;
					tileState.set(tileState.data);
					save()
				}
			}
		}
	}

	/**
	 *
	 * @param {MouseEvent} event
	 */
	function handleMouseUp(event) {
		if (state === 'idle') {
			return;
		}
		event.preventDefault();
		const [x, y] = getEventCoordinates(event);
		const dx = x - mouseDownOrigin.x;
		const dy = y - mouseDownOrigin.y;
		const distance = Math.sqrt(dx * dx + dy * dy);
		if (state === 'mousedown' && mouseDownOrigin.tileIndex !== -1 && distance < 0.05) {
			// there was little movement, process this as a click
			// rotate or lock a tile
			const tileIndex = mouseDownOrigin.tileIndex;
			const tileState = game.tileStates[tileIndex];
			const leftButton = mouseDownOrigin.button === 0;
			const rightButton = mouseDownOrigin.button === 2;
			if (currentSettings.controlMode === 'rotate_lock') {
				let rotationTimes = currentSettings.invertRotationDirection ? -1 : 1;
				if (leftButton && !event.ctrlKey) {
					game.rotateTile(tileIndex, rotationTimes);
				} else if (leftButton && event.ctrlKey) {
					game.rotateTile(tileIndex, -rotationTimes);
				} else if (rightButton) {
					tileState.toggleLocked();
				}
			} else if (currentSettings.controlMode === 'rotate_rotate') {
				let rotationTimes = currentSettings.invertRotationDirection ? -1 : 1;
				if (leftButton && event.ctrlKey) {
					tileState.toggleLocked();
				} else if (leftButton && !event.ctrlKey) {
					game.rotateTile(tileIndex, rotationTimes);
				} else if (rightButton) {
					game.rotateTile(tileIndex, -rotationTimes);
				}
			} else if (currentSettings.controlMode === 'orient_lock') {
				if (leftButton) {
					const { tileX, tileY } = mouseDownOrigin;
					const newAngle = Math.atan2(tileY - y, x - tileX);
					const oldAngle = grid.getTileAngle(tileState.data.tile);
					const newRotations = Math.round(((oldAngle - newAngle) * 3) / Math.PI);
					let timesRotate = newRotations - (tileState.data.rotations % 6);
					if (timesRotate < -3.5) {
						timesRotate += 6;
					} else if (timesRotate > 3.5) {
						timesRotate -= 6;
					}
					game.rotateTile(tileIndex, timesRotate);
				} else if (rightButton) {
					tileState.toggleLocked();
				}
			}
			save()
		} else if (state === 'mousedown' && mouseDownOrigin.tileIndex !== -1 && distance >= 0.1) {
			// this might be drawing an edge mark
			const tileIndex = mouseDownOrigin.tileIndex;
			const { tileX, tileY } = mouseDownOrigin;
			let startAngle = Math.atan2(tileY - mouseDownOrigin.y, mouseDownOrigin.x - tileX);
			let endAngle = Math.atan2(tileY - y, x - tileX);
			startAngle += startAngle < 0 ? 2 * Math.PI : 0;
			endAngle += endAngle < 0 ? 2 * Math.PI : 0;
			let deltaAngle = Math.abs(startAngle - endAngle);
			let meanAngle = 0.5 * (startAngle + endAngle);
			if (deltaAngle > Math.PI) {
				deltaAngle = 2 * Math.PI - deltaAngle;
				meanAngle -= Math.PI;
			}
			const directionIndex = Math.round((meanAngle * 3) / Math.PI);
			const startRadius = Math.sqrt(
				(tileY - mouseDownOrigin.y) ** 2 + (mouseDownOrigin.x - tileX) ** 2
			);
			const endRadius = Math.sqrt((tileY - y) ** 2 + (x - tileX) ** 2);
			const meanRadius = 0.5 * (startRadius + endRadius);
			if (
				Math.abs(meanRadius - 0.5) <= 0.1 &&
				Math.abs(meanAngle - (directionIndex * Math.PI) / 3) < 0.2
			) {
				// was close to tile border
				// in a well defined direction
				// toggle an edgemark here
				const distanceAlongBorder = 0.5 * deltaAngle;
				const distanceAcrossBorder = Math.abs(startRadius - endRadius);
				if (distanceAlongBorder > distanceAcrossBorder) {
					game.toggleEdgeMark('wall', tileIndex, grid.DIRECTIONS[directionIndex % 6]);
				} else {
					game.toggleEdgeMark('conn', tileIndex, grid.DIRECTIONS[directionIndex % 6]);
				}
				save()
			}
		}
		lockingSet.clear();
		state = 'idle';
	}

	function handleMouseLeave() {
		state = 'idle';
		lockingSet.clear();
	}

	/** @type {Boolean|undefined} */
	let USING_A_TOUCHPAD = undefined
	
	/**
	 * Tries to detect if the user has a touchpad rather than a mouse
	 * @param {WheelEvent} event 
	 */
	function checkForTouchpad(event) {
		let misses = 0
		const normalized = normalizeWheel(event)
		if ((Math.abs(normalized.spinY)<1)||(normalized.pixelX!==0)) {
			USING_A_TOUCHPAD = true
		} else {
			misses += 1
		}
		if (misses > 20) {
			USING_A_TOUCHPAD = false
		}
		if (USING_A_TOUCHPAD !== undefined) {
			window.removeEventListener('wheel', checkForTouchpad)
		}
	}
	window.addEventListener('wheel', checkForTouchpad)

	/**
	 * Zoom in or out
	 * @param {WheelEvent} event
	 */
	function handleWheel(event) {
		const normalized = normalizeWheel(event)
		event.preventDefault();
		const [x, y] = getEventCoordinates(event);
		if (USING_A_TOUCHPAD) {
			if (event.ctrlKey) {
				grid.zoom(0.5*normalized.spinY, x, y);
			} else {
				// pan with 2-finger slides on touchpad
				const dx = (normalized.pixelX / pixelsWidth) * viewBox.width
				const dy = (normalized.pixelY / pixelsHeight) * viewBox.height
				grid.pan(dx, dy)
			}
		} else {
			grid.zoom(normalized.spinY, x, y);
		}
	}

	node.addEventListener('mousedown', handleMouseDown);
	node.addEventListener('mousemove', handleMouseMove);
	node.addEventListener('mouseleave', handleMouseLeave);
	node.addEventListener('mouseup', handleMouseUp);
	node.addEventListener('wheel', handleWheel);

	return {
		destroy() {
			node.removeEventListener('mousedown', handleMouseDown);
			node.removeEventListener('mousemove', handleMouseMove);
			node.removeEventListener('mouseleave', handleMouseLeave);
			node.removeEventListener('mouseup', handleMouseUp);
			node.removeEventListener('wheel', handleWheel);
			window.removeEventListener('wheel', checkForTouchpad)
			unsubscribeViewBox();
			unsubscribeSettings();
		}
	};
}
