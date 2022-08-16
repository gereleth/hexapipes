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

	/**
	 * Tells if a point is close to one of tile's edges
	 * @param {PointerOrigin} point
	 */
	function whichEdge(point) {
		const { x, y, tileX, tileY } = point;
		const dx = x - tileX;
		const dy = tileY - y;
		const deltaRadius = Math.abs(Math.sqrt(dx ** 2 + dy ** 2) - 0.5);
		let angle = Math.atan2(dy, dx);
		angle += angle < 0 ? 2 * Math.PI : 0;
		const directionIndex = Math.round((angle * 3) / Math.PI) % 6;
		const direction = game.grid.DIRECTIONS[directionIndex];
		const directionAngle = (directionIndex * Math.PI) / 3;
		let deltaAngle = Math.abs(angle - directionAngle);
		deltaAngle = Math.min(deltaAngle, 2 * Math.PI - deltaAngle);
		return {
			direction,
			isClose: deltaRadius <= 0.15 && deltaAngle <= 0.35
		};
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

		const maybeTile = target.closest('g.tile');
		if (maybeTile) {
			mouseDownOrigin.tileIndex = Number(maybeTile.getAttribute('data-index'));
			mouseDownOrigin.tileX = Number(maybeTile.getAttribute('data-x'));
			mouseDownOrigin.tileY = Number(maybeTile.getAttribute('data-y'));
		}

		if (mouseDownOrigin.tileIndex === -1) {
			state = 'idle';
		} else {
			const { direction, isClose } = whichEdge(mouseDownOrigin);

			if (isClose) {
				// close to the edge, may be wanting an edge mark
				edgeMarkTimer = setTimeout(() => {
					const mark = mouseDownOrigin.button === 0 ? 'wall' : 'conn';
					game.toggleEdgeMark(mark, mouseDownOrigin.tileIndex, direction);
					state = 'edgemark';
				}, 500);
				state = 'mousedown';
			} else {
				if (mouseDownOrigin.locking) {
					lockingSet.add(mouseDownOrigin.tileIndex);
					const tileState = game.tileStates[mouseDownOrigin.tileIndex];
					tileState.toggleLocked();
					state = tileState.data.locked ? 'locking' : 'unlocking';
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
					const tileState = game.tileStates[mouseDownOrigin.tileIndex];
					tileState.toggleLocked();
					state = tileState.data.locked ? 'locking' : 'unlocking';
					save();
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

		if (state === 'mousedown' && mouseDownOrigin.tileIndex !== -1 && distance >= 0.1) {
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
				save();
				state = 'idle';
			}
		}
		if (state === 'mousedown' && mouseDownOrigin.tileIndex !== -1) {
			const maybeTile = event.target.closest('g.tile');
			if (maybeTile) {
				const tileIndex = Number(maybeTile.getAttribute('data-index'));
				if (tileIndex !== mouseDownOrigin.tileIndex) {
					// left the tile
					// but traveled a small distance
					// and not like drawing an edgemark
					// don't know how to process this case, do nothing for now
					state = 'idle';
					return;
				}
			}
			// stayed in the same tile, process this as a click
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
	window.addEventListener('wheel', checkForTouchpad);

	/**
	 * Zoom in or out
	 * @param {WheelEvent} event
	 */
	function handleWheel(event) {
		if (event.target === node) {
			// allow scrolling when the mouse is over empty space
			return;
		}
		const normalized = normalizeWheel(event);
		event.preventDefault();
		const [x, y] = getEventCoordinates(event);
		if (USING_A_TOUCHPAD) {
			if (event.ctrlKey) {
				const delta = 0.5 * viewBox.width * 0.07 * normalized.spinY;
				grid.zoom(viewBox.width + delta, x, y);
			} else {
				// pan with 2-finger slides on touchpad
				const dx = (normalized.pixelX / pixelsWidth) * viewBox.width;
				const dy = (normalized.pixelY / pixelsHeight) * viewBox.height;
				grid.pan(dx, dy);
			}
		} else {
			const delta = viewBox.width * 0.07 * normalized.spinY;
			grid.zoom(viewBox.width + delta, x, y);
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
				const maybeTile = touch.target.closest('g.tile');
				if (maybeTile) {
					data.tileIndex = Number(maybeTile.getAttribute('data-index'));
					data.tileX = Number(maybeTile.getAttribute('data-x'));
					data.tileY = Number(maybeTile.getAttribute('data-y'));
				}
				ongoingTouches.push(data);
			}
		}
		if (touchState === 'idle') {
			const tileIndex = ongoingTouches[0].tileIndex;
			if (tileIndex !== -1) {
				touchState = 'touchdown';
				// event.preventDefault();
				// start locking/unlocking if user holds for long enough
				touchTimer = setTimeout(() => {
					if (
						currentSettings.controlMode === 'rotate_lock' ||
						currentSettings.controlMode === 'orient_lock'
					) {
						const tileState = game.tileStates[tileIndex];
						tileState.toggleLocked();
						save();
						touchState = tileState.data.locked ? 'locking' : 'unlocking';
						lockingSet.add(tileIndex);
					} else if (currentSettings.controlMode === 'rotate_rotate') {
						const rotationTimes = currentSettings.invertRotationDirection ? 1 : -1;
						game.rotateTile(tileIndex, rotationTimes);
						save();
						touchState = 'idle';
						ongoingTouches = [];
					}
				}, 700);
			} else {
				touchState = 'idle';
			}
		} else if (touchState === 'touchdown') {
			if (useZoomPan) {
				touchState = 'zoom_pan';
			} else {
				touchstate = 'idle';
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
			grid.pan(newx - oldx, newy - oldy);
			// zooming
			const oldDistance = Math.sqrt(
				(ongoingTouches[0].clientX - ongoingTouches[1].clientX) ** 2 +
					(ongoingTouches[0].clientY - ongoingTouches[1].clientY) ** 2
			);
			const newDistance = Math.sqrt(
				(newTouches[0].clientX - newTouches[1].clientX) ** 2 +
					(newTouches[0].clientY - newTouches[1].clientY) ** 2
			);
			grid.zoom((ongoingTouches[0].width * oldDistance) / newDistance, newx, newy);
		} else if (touchState === 'locking' || touchState === 'unlocking') {
			event.preventDefault();
			const [x, y] = getEventCoordinates(event.touches[0]);
			const tileIndex = grid.xy_to_index(x, y);
			if (tileIndex !== -1) {
				if (!lockingSet.has(tileIndex)) {
					lockingSet.add(tileIndex);
					const tileState = game.tileStates[tileIndex];
					tileState.data.locked = touchState === 'locking' ? true : false;
					tileState.set(tileState.data);
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
			grid.pan(x - t0.x, y - t0.y);
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

			if (t.tileIndex !== -1 && distance >= 0.1) {
				// this might be drawing an edge mark
				const tileIndex = t.tileIndex;
				const { tileX, tileY } = t;
				let startAngle = Math.atan2(tileY - t.y, t.x - tileX);
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
				const startRadius = Math.sqrt((tileY - t.y) ** 2 + (t.x - tileX) ** 2);
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
					save();
					touchState = 'idle';
				}
			}
			if (touchState === 'touchdown' && t.tileIndex !== -1) {
				const upTileIndex = grid.xy_to_index(x, y);
				if (upTileIndex === t.tileIndex) {
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

	node.addEventListener('mousedown', handleMouseDown);
	node.addEventListener('mousemove', handleMouseMove);
	node.addEventListener('mouseleave', handleMouseUp);
	node.addEventListener('mouseup', handleMouseUp);
	if (useZoomPan) {
		node.addEventListener('wheel', handleWheel);
	}

	node.addEventListener('touchstart', handleTouchStart, { passive: false });
	node.addEventListener('touchmove', handleTouchMove, { passive: false });
	node.addEventListener('touchend', handleTouchEnd, { passive: false });
	node.addEventListener('touchcancel', handleTouchEnd, { passive: false });

	return {
		destroy() {
			node.removeEventListener('mousedown', handleMouseDown);
			node.removeEventListener('mousemove', handleMouseMove);
			node.removeEventListener('mouseleave', handleMouseUp);
			node.removeEventListener('mouseup', handleMouseUp);
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
