import { settings } from '$lib/stores';
import normalizeWheel from 'normalize-wheel';

/**
 * @typedef PointerOrigin
 * @property {Number} x
 * @property {Number} y
 * @property {Number} tileX
 * @property {Number} tileY
 * @property {Number} tileIndex
 * @property {Number} button
 * @property {Boolean} locking - true if a click like this should result in locking a tile
 */

/**
 * Attaches mouse/touch controls to the game area
 * @param {HTMLElement} node
 * @param {import('$lib/puzzle/game').PipesGame} game
 * @returns
 */
export function controls(node, game) {
	const grid = game.grid;

	/**
	 * @type {import('./viewbox').ViewBox}
	 */
	let viewBox;

	const unsubscribeViewBox = game.viewBox.subscribe((box) => {
		viewBox = box;
	});

	/**
	 * @type {import('$lib/stores').Settings}
	 */
	let currentSettings;
	settings.loadFromLocalStorage();
	const unsubscribeSettings = settings.subscribe((s) => {
		currentSettings = s;
	});
	// set this once to not deal with changes
	// changes will take effect on page refresh
	const useZoomPan = !currentSettings.disableZoomPan;

	const rect = node.getBoundingClientRect();
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
		tileIndex: 0,
		tileX: 0,
		tileY: 0,
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
		const { x, y, width, height } = node.getBoundingClientRect();
		const relativeX = (event.clientX - x) / width;
		const relativeY = (event.clientY - y) / height;
		const gameX = viewBox.xmin + relativeX * viewBox.width;
		const gameY = viewBox.ymin + relativeY * viewBox.height;
		return [gameX, gameY];
	}

	function save() {
		node.dispatchEvent(new CustomEvent('save'));
	}

	/** @type {NodeJS.Timer|undefined} */
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
			(currentSettings.controlMode === 'rotate_rotate' && event.button === 0 && event.ctrlKey) ||
			(currentSettings.controlMode === 'orient_lock' && event.button === 2);

		mouseDownOrigin = {
			x,
			y,
			button: event.button,
			tileIndex: -1,
			tileX: 0,
			tileY: 0,
			locking
		};
		const tile = game.grid.which_tile_at(x, y);
		if (tile.index !== -1) {
			mouseDownOrigin.tileIndex = tile.index;
			mouseDownOrigin.tileX = tile.x;
			mouseDownOrigin.tileY = tile.y;
		}

		if (mouseDownOrigin.tileIndex === -1) {
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
					game.toggleEdgeMark(
						mark,
						mouseDownOrigin.tileIndex,
						direction,
						currentSettings.assistant
					);
					state = 'edgemark';
				}, 300);
				state = 'mousedown';
			} else {
				if (mouseDownOrigin.locking) {
					lockingSet.add(mouseDownOrigin.tileIndex);
					const locked = game.toggleLocked(
						mouseDownOrigin.tileIndex,
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
					lockingSet.add(mouseDownOrigin.tileIndex);
					const locked = game.toggleLocked(
						mouseDownOrigin.tileIndex,
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
			const tile = game.grid.which_tile_at(x, y);
			if (tile.index !== -1) {
				if (!lockingSet.has(tile.index)) {
					lockingSet.add(tile.index);
					game.toggleLocked(tile.index, state === 'locking', currentSettings.assistant);
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

		if (state === 'mousedown' && mouseDownOrigin.tileIndex !== -1 && distance >= 0.2) {
			const tileIndex = mouseDownOrigin.tileIndex;
			// this might be drawing an edge mark
			const { mark, direction } = grid.detectEdgemarkGesture(
				tileIndex,
				mouseDownOrigin.tileX,
				mouseDownOrigin.tileY,
				mouseDownOrigin.x,
				x,
				mouseDownOrigin.y,
				y
			);
			if (mark !== 'none') {
				game.toggleEdgeMark(mark, tileIndex, direction, currentSettings.assistant);
				save();
				touchState = 'idle';
			}
		}
		if (state === 'mousedown' && mouseDownOrigin.tileIndex !== -1 && distance <= 0.2) {
			// process this as a click
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
					game.toggleLocked(tileIndex, undefined, currentSettings.assistant);
				}
			} else if (currentSettings.controlMode === 'rotate_rotate') {
				let rotationTimes = currentSettings.invertRotationDirection ? -1 : 1;
				if (leftButton && event.ctrlKey) {
					game.toggleLocked(tileIndex, undefined, currentSettings.assistant);
				} else if (leftButton && !event.ctrlKey) {
					game.rotateTile(tileIndex, rotationTimes);
				} else if (rightButton) {
					game.rotateTile(tileIndex, -rotationTimes);
				}
			} else if (currentSettings.controlMode === 'orient_lock') {
				if (leftButton) {
					const { tileX, tileY } = mouseDownOrigin;
					const timesRotate = game.grid.clickOrientTile(
						tileState.data.tile,
						tileState.data.rotations,
						x - tileX,
						y - tileY,
						tileIndex
					);
					game.rotateTile(tileIndex, timesRotate);
				} else if (rightButton) {
					game.toggleLocked(tileIndex, undefined, currentSettings.assistant);
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
	 * @property {Number} tileX
	 * @property {Number} tileY
	 * @property {Number} tileIndex
	 * @property {Number} clientX
	 * @property {Number} clientY
	 * @property {Number} width
	 */

	/**@type {TouchOrigin[]} */
	let ongoingTouches = [];
	/**@type {'idle'|'touchdown'|'zoom_pan'|'panning'|'locking'|'unlocking'} */
	let touchState = 'idle';
	/** @type {NodeJS.Timer|undefined} */
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
					tileIndex: -1,
					tileX: 0,
					tileY: 0,
					width: viewBox.width
				};
				const tile = game.grid.which_tile_at(x, y);
				if (tile.index !== -1) {
					data.tileIndex = tile.index;
					data.tileX = tile.x;
					data.tileY = tile.y;
				}
				ongoingTouches.push(data);
			}
		}
		if (touchState === 'idle') {
			const tileIndex = ongoingTouches[0].tileIndex;
			const x = ongoingTouches[0].x;
			const y = ongoingTouches[0].y;
			if (tileIndex !== -1) {
				touchState = 'touchdown';
				// event.preventDefault();
				// start locking/unlocking if user holds for long enough
				touchTimer = setTimeout(() => {
					if (
						currentSettings.controlMode === 'rotate_lock' ||
						currentSettings.controlMode === 'orient_lock'
					) {
						const locked = game.toggleLocked(tileIndex, undefined, currentSettings.assistant);
						save();
						touchState = locked ? 'locking' : 'unlocking';
						lockingSet.add(tileIndex);
					} else if (currentSettings.controlMode === 'rotate_rotate') {
						const rotationTimes = currentSettings.invertRotationDirection ? 1 : -1;
						game.rotateTile(tileIndex, rotationTimes);
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
				const index = ids.indexOf(touch.identifier);
				if (index === -1) {
					continue;
				}
				const [x, y] = getEventCoordinates(touch);
				newTouches[index].x = x;
				newTouches[index].y = y;
				newTouches[index].clientX = touch.clientX;
				newTouches[index].clientY = touch.clientY;
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
			const tile = grid.which_tile_at(x, y);
			if (tile.index !== -1) {
				if (!lockingSet.has(tile.index)) {
					lockingSet.add(tile.index);
					game.toggleLocked(tile.index, touchState === 'locking', currentSettings.assistant);
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

			if (t.tileIndex !== -1 && distance >= 0.2) {
				const { mark, direction } = grid.detectEdgemarkGesture(
					t.tileIndex,
					t.tileX,
					t.tileY,
					t.x,
					x,
					t.y,
					y
				);
				if (mark !== 'none') {
					game.toggleEdgeMark(mark, t.tileIndex, direction, currentSettings.assistant);
					save();
					touchState = 'idle';
				}
			}
			if (touchState === 'touchdown' && t.tileIndex !== -1 && distance <= 0.2) {
				const upTile = grid.which_tile_at(x, y);
				if (upTile.index === t.tileIndex) {
					// stayed in the same tile, process this as a click
					// rotate or lock a tile
					const tileIndex = t.tileIndex;
					const tileState = game.tileStates[tileIndex];
					if (
						currentSettings.controlMode === 'rotate_lock' ||
						currentSettings.controlMode === 'rotate_rotate'
					) {
						let rotationTimes = currentSettings.invertRotationDirection ? -1 : 1;
						game.rotateTile(tileIndex, rotationTimes);
						save();
					} else if (currentSettings.controlMode === 'orient_lock') {
						const { tileX, tileY } = t;
						const timesRotate = game.grid.clickOrientTile(
							tileState.data.tile,
							tileState.data.rotations,
							x - tileX,
							y - tileY,
							tileIndex
						);
						game.rotateTile(tileIndex, timesRotate);
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

	node.addEventListener('mousedown', handleMouseDown);
	node.addEventListener('mousemove', handleMouseMove);
	document.addEventListener('mouseup', handleMouseUp);
	document.addEventListener('keydown', handleKeyDown);
	document.addEventListener('keyup', handleKeyUp);
	if (useZoomPan) {
		node.addEventListener('wheel', handleWheel, { passive: false });
	}

	node.addEventListener('touchstart', handleTouchStart, { passive: false });
	node.addEventListener('touchmove', handleTouchMove, { passive: false });
	node.addEventListener('touchend', handleTouchEnd, { passive: false });
	node.addEventListener('touchcancel', handleTouchEnd, { passive: false });

	return {
		destroy() {
			node.removeEventListener('mousedown', handleMouseDown);
			node.removeEventListener('mousemove', handleMouseMove);
			document.removeEventListener('mouseup', handleMouseUp);
			document.addEventListener('keydown', handleKeyDown);
			document.addEventListener('keyup', handleKeyUp);
			node.removeEventListener('wheel', handleWheel);
			window.removeEventListener('wheel', checkForTouchpad);

			node.removeEventListener('touchstart', handleTouchStart);
			node.removeEventListener('touchmove', handleTouchMove);
			node.removeEventListener('touchend', handleTouchEnd);
			node.removeEventListener('touchcancel', handleTouchEnd);

			unsubscribeViewBox();
			unsubscribeSettings();
		}
	};
}
