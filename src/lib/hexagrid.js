export const EAST = 1;
export const NORTHEAST = 2;
export const NORTHWEST = 4;
export const WEST = 8;
export const SOUTHWEST = 16;
export const SOUTHEAST = 32;

export const YSTEP = Math.sqrt(3) / 2;

export const DIRECTIONS = [EAST, NORTHEAST, NORTHWEST, WEST, SOUTHWEST, SOUTHEAST];

export const OPPOSITE = new Map([
	[NORTHEAST, SOUTHWEST],
	[SOUTHWEST, NORTHEAST],
	[EAST, WEST],
	[WEST, EAST],
	[NORTHWEST, SOUTHEAST],
	[SOUTHEAST, NORTHWEST]
]);

export const XY_DELTAS = new Map([
	[EAST, [1, 0]],
	[WEST, [-1, 0]],
	[NORTHEAST, [0.5, YSTEP]],
	[NORTHWEST, [-0.5, YSTEP]],
	[SOUTHEAST, [0.5, -YSTEP]],
	[SOUTHWEST, [-0.5, -YSTEP]]
]);

/**
 * @param {Number} width
 * @param {Number} height
 */
export function HexaGrid(width, height, wrap=false) {
	let self = this;

	this.width = width;
	this.height = height;
	this.total = width * height;
	this.wrap = wrap

	this.RC_DELTA = new Map([
		[
			EAST,
			[
				[0, 1],
				[0, 1]
			]
		],
		[
			NORTHEAST,
			[
				[-1, 0],
				[-1, 1]
			]
		],
		[
			NORTHWEST,
			[
				[-1, -1],
				[-1, 0]
			]
		],
		[
			WEST,
			[
				[0, -1],
				[0, -1]
			]
		],
		[
			SOUTHWEST,
			[
				[1, -1],
				[1, 0]
			]
		],
		[
			SOUTHEAST,
			[
				[1, 0],
				[1, 1]
			]
		]
	]);

	/**
	 * @param {Number} index
	 */
	this.index_to_xy = function (index) {
		let q = 2 * self.width;
		let a = index % q;
		let b = (index - a) / q;
		let x, y;
		if (a < self.width) {
			x = a;
			y = YSTEP * (self.height - 1 - 2 * b);
		} else {
			x = a - self.width + 0.5;
			y = YSTEP * (self.height - 2 - 2 * b);
		}
		return [x, y];
	};
	/**
	 * @param {Number} index
	 * @param {Number} direction
	 */
	this.find_neighbour = function (index, direction) {
		let c = index % self.width;
		let r = (index - c) / self.width;
		let wrapped = false
		let neighbour = -1

		const [dr, dc] = self.RC_DELTA.get(direction)[r % 2];
		r += dr;
		c += dc;
		if (self.wrap) {
			if (r == -1) {
				r = self.height - 1
				c += 1
				wrapped = true
			}
			if (r == self.height) {
				r = 0
				c -= (1 - self.height % 2)
				wrapped = true
			}
			if ((c < 0)||(c=== self.width)) {
				c = (c + self.width) % self.width
				wrapped = true
			}
		}
		if (r < 0 || r >= self.height) {
			neighbour = -1;
		}
		else if (c < 0 || c >= self.width) {
			neighbour = -1;
		} else {
			neighbour = self.width * r + c
		}
		return {
			neighbour,
			wrapped,
		};
	};


	this.getEdgeMarks = function() {
		const edgeMarks = []
		for (let i=0; i<self.total; i++) {
			const [x, y] = self.index_to_xy(i)
			for (let direction of DIRECTIONS) {
				const {neighbour, wrapped} = self.find_neighbour(i, direction)
				if (neighbour > i) {
					const [dx, dy] = XY_DELTAS.get(direction)
					const mark = {
						x: x+dx*0.5,
						y: self.height*YSTEP - (y+dy*0.5),
						direction: direction,
						state: 'none',
					}
					if (wrapped) {
						const [nx, ny] = self.index_to_xy(neighbour)
						mark.wrapX = nx - dx*0.5
						mark.wrapY = self.height*YSTEP - (ny-dy*0.5)
					}
					edgeMarks.push(mark)
				}
			}
		}
		return edgeMarks
	}

	this.rotate = function(tile, rotations) {
		let rotated = tile
		rotations = rotations % 6
		while (rotations > 0) {
			rotations -= 6
		}
		while (rotations < 0) {
			rotated = (rotated*2) % 64 + Math.floor(rotated/32)
			rotations += 1
		}
		return rotated
	}

	this.getDirections = function (tile, rotations=0) {
		const rotated = self.rotate(tile, rotations)
		return DIRECTIONS.filter((direction) => (direction & rotated) > 0);
	};

	this.tilePath = '';
	for (let p = 0; p < 6; p++) {
		const angle = (Math.PI * (2 * p + 1)) / 6;
		const dx = (0.49 * Math.cos(angle)) / YSTEP;
		const dy = (-0.49 * Math.sin(angle)) / YSTEP;
		if (this.tilePath === '') {
			this.tilePath += ` m ${dx - 0.49} ${dy + 0.98*YSTEP}`;
		}
		this.tilePath += ` l ${dx} ${dy}`;
	}
	this.tilePath += ' z';
	return this;
}
