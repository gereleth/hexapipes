import { settings } from '#lib/stores.js';
import { get } from 'svelte/store';
import normalizeWheel from 'normalize-wheel';

/**
 * @typedef PointerOrigin
 * @property {Number} x
 * @property {Number} y
 * @property {Number} cellX
 * @property {Number} cellY
 * @property {Number} index
 * @property {Number} button
 * @property {Boolean} locking - true if a click like this should result in locking a tile
 */

/**
 * Attaches mouse/touch controls to the game area
 * @param {Element & GlobalEventHandlers} DOMnode
 * @param {import('#lib/puzzle/game/game.svelte.js').PipesGame} game
 * @returns
 */
export function controls(DOMnode, game) {
	const grid = game.grid;

	/**
	 * @type {import('#lib/puzzle/game/viewbox.js').ViewBox}
	 */
	let viewBox;

	const unsubscribeViewBox = game.viewBox.subscribe((box) => {
		viewBox = box;
	});

	/**
	 * @type {import('#lib/stores.js').Settings}
	 */
	settings.loadFromLocalStorage();
	let currentSettings = get(settings);
	const unsubscribeSettings = settings.subscribe((s) => {
		currentSettings = s;
	});
	// set this once to not deal with changes
	// changes will take effect on page refresh
	const useZoomPan = !currentSettings.disableZoomPan;

	const rect = DOMnode.getBoundingClientRect();
	const pixelsWidth = rect.width;
	const pixelsHeight = rect.height;

	/**
	 * @type {'idle'|'mousedown'|'panning'|'locking'|'unlocking'|'edgemark'}
	 */
	let state = 'idle';
	/** @type PointerOrigin */
	let mouseDownOrigin = {
		x: 0,
		y: 0,
		button: 0,
		index: 0,
		cellX: 0,
		cellY: 0,
		locking: false
	};

	/**
	 * @type {Set<Number>}
	 */
	let lockingSet = new Set();

	/**
	 * Compute X and Y coordinates of the event in game grid units
	 * @param {MouseEvent|Touch} event
	 * @returns {Number[]}
	 */
	function getEventCoordinates(event) {
		const { x, y, width, height } = DOMnode.getBoundingClientRect();
		const relativeX = (event.clientX - x) / width;
		const relativeY = (event.clientY - y) / height;
		const gameX = viewBox.xmin + relativeX * viewBox.width;
		const gameY = viewBox.ymin + relativeY * viewBox.height;
		return [gameX, gameY];
	}

	function save() {
		DOMnode.dispatchEvent(new CustomEvent('save'));
	}

	/** @type {ReturnType<typeof setTimeout>} */
	let edgeMarkTimer;
	/**
	 *
	 * @param {MouseEvent} event
	 */
	function handleMouseDown(event) {
		event.preventDefault();
		const target = event.target;
		const [x, y] = getEventCoordinates(event);
		const locking =
			(currentSettings.controlMode === 'rotate_lock' && event.button === 2) ||
			(currentSettings.controlMode === 'rotate_rotate' && event.button !== 1 && event.ctrlKey) ||
			(currentSettings.controlMode === 'orient_lock' && event.button === 2);

		mouseDownOrigin = {
			x,
			y,
			button: event.button,
			index: -1,
			cellX: 0,
			cellY: 0,
			locking
		};
		const cell = game.grid.whichCellAt(x, y);
		if (cell.index !== -1) {
			mouseDownOrigin.index = cell.index;
			mouseDownOrigin.cellX = cell.x;
			mouseDownOrigin.cellY = cell.y;
		}

		if (mouseDownOrigin.index === -1) {
			if (!useZoomPan) {
				state = 'idle';
			} else if (!grid.wrap && (x < grid.XMIN || x > grid.XMAX || y < grid.YMIN || y > grid.YMAX)) {
				state = 'idle';
			} else {
				state = 'panning';
			}
		} else {
			const { direction, isClose } = game.grid.whichEdge(mouseDownOrigin);
			if (isClose) {
				// close to the edge, may be wanting an edge mark
				edgeMarkTimer = setTimeout(() => {
					const mark = mouseDownOrigin.button === 0 ? 'wall' : 'conn';
					game.toggleEdgeMark(mark, mouseDownOrigin.index, direction, currentSettings.assistant);
					state = 'edgemark';
				}, 300);
				state = 'mousedown';
			} else {
				if (mouseDownOrigin.locking) {
					lockingSet.add(mouseDownOrigin.index);
					const locked = game.toggleLocked(
						mouseDownOrigin.index,
						undefined,
						currentSettings.assistant
					);
					state = locked ? 'locking' : 'unlocking';
					save();
				} else {
					state = 'mousedown';
				}
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
		if (state === 'mousedown') {
			const distance = Math.sqrt(dx * dx + dy * dy);
			if (distance >= 1) {
				if (useZoomPan && mouseDownOrigin.button === 0) {
					state = 'panning';
				} else {
					state = 'idle';
				}
			}
			if (distance >= 0.05) {
				clearTimeout(edgeMarkTimer);
				if (mouseDownOrigin.locking) {
					lockingSet.add(mouseDownOrigin.index);
					const locked = game.toggleLocked(
						mouseDownOrigin.index,
						undefined,
						currentSettings.assistant
					);
					state = locked ? 'locking' : 'unlocking';
					save();
				}
			}
		}
		if (state === 'panning') {
			game.viewBox.pan(dx, dy);
		} else if (state === 'locking' || state === 'unlocking') {
			const cell = game.grid.whichCellAt(x, y);
			if (cell.index !== -1) {
				if (!lockingSet.has(cell.index)) {
					lockingSet.add(cell.index);
					game.toggleLocked(cell.index, state === 'locking', currentSettings.assistant);
					save();
				}
			}
		}
	}

	/**
	 *
	 * @param {MouseEvent} event
	 */
	function handleMouseUp(event) {
		clearTimeout(edgeMarkTimer);
		if (state === 'idle' || state === 'edgemark') {
			return;
		}
		event.preventDefault();
		const [x, y] = getEventCoordinates(event);
		const dx = x - mouseDownOrigin.x;
		const dy = y - mouseDownOrigin.y;
		const distance = Math.sqrt(dx * dx + dy * dy);

		if (state === 'mousedown' && mouseDownOrigin.index !== -1 && distance >= 0.2) {
			const index = mouseDownOrigin.index;
			// this might be drawing an edge mark
			const { mark, direction } = grid.detectEdgemarkGesture(
				index,
				mouseDownOrigin.cellX,
				mouseDownOrigin.cellY,
				mouseDownOrigin.x,
				x,
				mouseDownOrigin.y,
				y
			);
			if (mark !== 'none') {
				game.toggleEdgeMark(mark, index, direction, currentSettings.assistant);
				save();
				touchState = 'idle';
			}
		}
		if (state === 'mousedown' && mouseDownOrigin.index !== -1 && distance <= 0.2) {
			// process this as a click
			// rotate or lock a tile
			const index = mouseDownOrigin.index;
			const tileState = game.tileStates[index];
			const leftButton = mouseDownOrigin.button === 0;
			const rightButton = mouseDownOrigin.button === 2;
			if (currentSettings.controlMode === 'rotate_lock') {
				let rotationTimes = currentSettings.invertRotationDirection ? -1 : 1;
				if (leftButton && !event.ctrlKey) {
					game.rotateTile(index, rotationTimes);
				} else if (leftButton && event.ctrlKey) {
					game.rotateTile(index, -rotationTimes);
				} else if (rightButton) {
					game.toggleLocked(index, undefined, currentSettings.assistant);
				}
			} else if (currentSettings.controlMode === 'rotate_rotate') {
				let rotationTimes = currentSettings.invertRotationDirection ? -1 : 1;
				if (leftButton && event.ctrlKey) {
					game.toggleLocked(index, undefined, currentSettings.assistant);
				} else if (leftButton && !event.ctrlKey) {
					game.rotateTile(index, rotationTimes);
				} else if (rightButton) {
					game.rotateTile(index, -rotationTimes);
				}
			} else if (currentSettings.controlMode === 'orient_lock') {
				if (leftButton) {
					const { cellX, cellY } = mouseDownOrigin;
					const timesRotate = game.grid.clickOrientPipe(
						tileState.pipeUnion,
						tileState.rotations,
						x - cellX,
						y - cellY,
						index
					);
					game.rotateTile(index, timesRotate);
				} else if (rightButton) {
					game.toggleLocked(index, undefined, currentSettings.assistant);
				}
			}
			save();
		}
		lockingSet.clear();
		state = 'idle';
	}

	/** @type {Boolean|undefined} */
	let USING_A_TOUCHPAD = undefined;
	/**
	 * Tries to detect if the user has a touchpad rather than a mouse
	 * @param {WheelEvent} event
	 */
	function checkForTouchpad(event) {
		let misses = 0;
		const normalized = normalizeWheel(event);
		if (Math.abs(normalized.spinY) < 1 || normalized.pixelX !== 0) {
			USING_A_TOUCHPAD = true;
		} else {
			misses += 1;
		}
		if (misses > 20) {
			USING_A_TOUCHPAD = false;
		}
		if (USING_A_TOUCHPAD !== undefined) {
			window.removeEventListener('wheel', checkForTouchpad);
		}
	}
	window.addEventListener('wheel', checkForTouchpad, { passive: true });

	/**
	 * Zoom in or out
	 * @param {WheelEvent} event
	 */
	function handleWheel(event) {
		const [x, y] = getEventCoordinates(event);
		if (!grid.wrap && (x < grid.XMIN || x > grid.XMAX || y < grid.YMIN || y > grid.YMAX)) {
			// allow scrolling when the mouse is over empty space
			return;
		}
		const normalized = normalizeWheel(event);
		event.preventDefault();
		if (USING_A_TOUCHPAD) {
			if (event.ctrlKey) {
				const delta = 0.5 * viewBox.width * 0.07 * normalized.spinY;
				game.viewBox.zoom(viewBox.width + delta, x, y);
			} else {
				// pan with 2-finger slides on touchpad
				const dx = (normalized.pixelX / pixelsWidth) * viewBox.width;
				const dy = (normalized.pixelY / pixelsHeight) * viewBox.height;
				const sensitivity = 0.5;
				game.viewBox.pan(-dx * sensitivity, -dy * sensitivity);
			}
		} else {
			const delta = viewBox.width * 0.07 * normalized.spinY;
			game.viewBox.zoom(viewBox.width + delta, x, y);
		}
	}

	/* TOUCH HANDLING */

	/**
	 * @typedef TouchOrigin
	 * @property {Number} id
	 * @property {Number} x
	 * @property {Number} y
	 * @property {Number} cellX
	 * @property {Number} cellY
	 * @property {Number} index
	 * @property {Number} clientX
	 * @property {Number} clientY
	 * @property {Number} width
	 */

	/**@type {TouchOrigin[]} */
	let ongoingTouches = [];
	/**@type {'idle'|'touchdown'|'zoom_pan'|'panning'|'locking'|'unlocking'} */
	let touchState = 'idle';
	/** @type {ReturnType<typeof setTimeout>} */
	let touchTimer;
	/**
	 *
	 * @param {TouchEvent} event
	 */
	function handleTouchStart(event) {
		document.body.classList.add('no-selection');
		if (ongoingTouches.length < 2) {
			for (let i = 0; i < event.changedTouches.length; i++) {
				const touch = event.changedTouches.item(i);
				if (touch === null) {
					continue;
				}
				const [x, y] = getEventCoordinates(touch);
				const data = {
					x,
					y,
					id: touch.identifier,
					clientX: touch.clientX,
					clientY: touch.clientY,
					index: -1,
					cellX: 0,
					cellY: 0,
					width: viewBox.width
				};
				const cell = game.grid.whichCellAt(x, y);
				if (cell.index !== -1) {
					data.index = cell.index;
					data.cellX = cell.x;
					data.cellY = cell.y;
				}
				ongoingTouches.push(data);
			}
		}
		if (touchState === 'idle') {
			const index = ongoingTouches[0].index;
			const x = ongoingTouches[0].x;
			const y = ongoingTouches[0].y;
			if (index !== -1) {
				touchState = 'touchdown';
				// event.preventDefault();
				// start locking/unlocking if user holds for long enough
				touchTimer = setTimeout(() => {
					if (
						currentSettings.controlMode === 'rotate_lock' ||
						currentSettings.controlMode === 'orient_lock'
					) {
						const locked = game.toggleLocked(index, undefined, currentSettings.assistant);
						save();
						touchState = locked ? 'locking' : 'unlocking';
						lockingSet.add(index);
					} else if (currentSettings.controlMode === 'rotate_rotate') {
						const rotationTimes = currentSettings.invertRotationDirection ? 1 : -1;
						game.rotateTile(index, rotationTimes);
						save();
						touchState = 'idle';
						ongoingTouches = [];
					}
				}, 500);
			} else {
				if (!useZoomPan) {
					touchState = 'idle';
				} else if (
					!grid.wrap &&
					(x < grid.XMIN || x > grid.XMAX || y < grid.YMIN || y > grid.YMAX)
				) {
					touchState = 'idle';
				} else {
					touchState = 'panning';
				}
			}
		} else if (touchState === 'touchdown') {
			if (useZoomPan) {
				touchState = 'zoom_pan';
			} else {
				touchState = 'idle';
				ongoingTouches = [];
			}
			clearTimeout(touchTimer);
		}
	}

	/**
	 *
	 * @param {TouchEvent} event
	 */
	function handleTouchMove(event) {
		if (touchState === 'idle') {
			return;
		} else if (touchState === 'zoom_pan') {
			event.preventDefault();
			const ids = ongoingTouches.map((x) => x.id);
			const newTouches = ongoingTouches.map((touch) => {
				return { x: touch.x, y: touch.y, clientX: touch.clientX, clientY: touch.clientY };
			});
			for (let i = 0; i < event.touches.length; i++) {
				const touch = event.touches.item(i);
				if (touch === null) {
					continue;
				}
				const touchIndex = ids.indexOf(touch.identifier);
				if (touchIndex === -1) {
					continue;
				}
				const [x, y] = getEventCoordinates(touch);
				newTouches[touchIndex].x = x;
				newTouches[touchIndex].y = y;
				newTouches[touchIndex].clientX = touch.clientX;
				newTouches[touchIndex].clientY = touch.clientY;
			}
			// panning
			const oldx = 0.5 * (ongoingTouches[0].x + ongoingTouches[1].x);
			const newx = 0.5 * (newTouches[0].x + newTouches[1].x);
			const oldy = 0.5 * (ongoingTouches[0].y + ongoingTouches[1].y);
			const newy = 0.5 * (newTouches[0].y + newTouches[1].y);
			game.viewBox.pan(newx - oldx, newy - oldy);
			// zooming
			const oldDistance = Math.sqrt(
				(ongoingTouches[0].clientX - ongoingTouches[1].clientX) ** 2 +
					(ongoingTouches[0].clientY - ongoingTouches[1].clientY) ** 2
			);
			const newDistance = Math.sqrt(
				(newTouches[0].clientX - newTouches[1].clientX) ** 2 +
					(newTouches[0].clientY - newTouches[1].clientY) ** 2
			);
			game.viewBox.zoom((ongoingTouches[0].width * oldDistance) / newDistance, newx, newy);
		} else if (touchState === 'locking' || touchState === 'unlocking') {
			event.preventDefault();
			const [x, y] = getEventCoordinates(event.touches[0]);
			const cell = grid.whichCellAt(x, y);
			if (cell.index !== -1) {
				if (!lockingSet.has(cell.index)) {
					lockingSet.add(cell.index);
					game.toggleLocked(cell.index, touchState === 'locking', currentSettings.assistant);
					save();
				}
			}
		} else if (touchState === 'touchdown') {
			event.preventDefault();
			const [x, y] = getEventCoordinates(event.touches[0]);
			const t0 = ongoingTouches[0];
			const distance = Math.sqrt((x - t0.x) ** 2 + (y - t0.y) ** 2);
			if (distance >= 1) {
				clearTimeout(touchTimer);
				if (useZoomPan) {
					touchState = 'panning';
				} else {
					ongoingTouches = [];
					touchState = 'idle';
				}
			}
		} else if (touchState === 'panning') {
			event.preventDefault();
			const [x, y] = getEventCoordinates(event.touches[0]);
			const t0 = ongoingTouches[0];
			game.viewBox.pan(x - t0.x, y - t0.y);
		}
	}

	/**
	 *
	 * @param {TouchEvent} event
	 */
	function handleTouchEnd(event) {
		if (touchState !== 'idle') {
			event.preventDefault();
		}
		clearTimeout(touchTimer);
		if (touchState === 'touchdown') {
			const [x, y] = getEventCoordinates(event.changedTouches[0]);
			const t = ongoingTouches[0];
			const distance = Math.sqrt((x - t.x) ** 2 + (y - t.y) ** 2);

			if (t.index !== -1 && distance >= 0.2) {
				const { mark, direction } = grid.detectEdgemarkGesture(
					t.index,
					t.cellX,
					t.cellY,
					t.x,
					x,
					t.y,
					y
				);
				if (mark !== 'none') {
					game.toggleEdgeMark(mark, t.index, direction, currentSettings.assistant);
					save();
					touchState = 'idle';
				}
			}
			if (touchState === 'touchdown' && t.index !== -1 && distance <= 0.2) {
				const upCell = grid.whichCellAt(x, y);
				if (upCell.index === t.index) {
					// stayed in the same tile, process this as a click
					// rotate or lock a tile
					const index = t.index;
					const tileState = game.tileStates[index];
					if (
						currentSettings.controlMode === 'rotate_lock' ||
						currentSettings.controlMode === 'rotate_rotate'
					) {
						let rotationTimes = currentSettings.invertRotationDirection ? -1 : 1;
						game.rotateTile(index, rotationTimes);
						save();
					} else if (currentSettings.controlMode === 'orient_lock') {
						const { cellX, cellY } = t;
						const timesRotate = game.grid.clickOrientPipe(
							tileState.pipeUnion,
							tileState.rotations,
							x - cellX,
							y - cellY,
							index
						);
						game.rotateTile(index, timesRotate);
						save();
					}
				}
			}
		}
		if (event.touches.length === 0) {
			document.body.classList.remove('no-selection');
		}
		touchState = 'idle';
		ongoingTouches = [];
		lockingSet.clear();
	}

	/**
	 * Handle keydown events
	 * @param {KeyboardEvent} event
	 */
	function handleKeyDown(event) {}

	/**
	 * Handle keyup events
	 * @param {KeyboardEvent} event
	 */
	function handleKeyUp(event) {}

	DOMnode.addEventListener('mousedown', handleMouseDown);
	DOMnode.addEventListener('mousemove', handleMouseMove);
	document.addEventListener('mouseup', handleMouseUp);
	document.addEventListener('keydown', handleKeyDown);
	document.addEventListener('keyup', handleKeyUp);
	if (useZoomPan) {
		DOMnode.addEventListener('wheel', handleWheel, { passive: false });
	}

	DOMnode.addEventListener('touchstart', handleTouchStart, { passive: false });
	DOMnode.addEventListener('touchmove', handleTouchMove, { passive: false });
	DOMnode.addEventListener('touchend', handleTouchEnd, { passive: false });
	DOMnode.addEventListener('touchcancel', handleTouchEnd, { passive: false });

	return {
		destroy() {
			DOMnode.removeEventListener('mousedown', handleMouseDown);
			DOMnode.removeEventListener('mousemove', handleMouseMove);
			document.removeEventListener('mouseup', handleMouseUp);
			document.addEventListener('keydown', handleKeyDown);
			document.addEventListener('keyup', handleKeyUp);
			DOMnode.removeEventListener('wheel', handleWheel);
			window.removeEventListener('wheel', checkForTouchpad);

			DOMnode.removeEventListener('touchstart', handleTouchStart);
			DOMnode.removeEventListener('touchmove', handleTouchMove);
			DOMnode.removeEventListener('touchend', handleTouchEnd);
			DOMnode.removeEventListener('touchcancel', handleTouchEnd);

			unsubscribeViewBox();
			unsubscribeSettings();
		}
	};
}
