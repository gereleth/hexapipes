import {range, cross, min, max, extent, mean, deviation} from 'd3-array';
import {randomUniform} from 'd3-random';

var GOLDEN_RATIO = 0.6180339887498948482;


// from Eyal's answer, based on Hassan's, on Stack Overflow
// Detection of Triangle Collision in 2D Space
// https://stackoverflow.com/a/44269990


// check that all points of the other triangle are on the same side of the triangle after mapping to barycentric coordinates.
// returns true if all points are outside on the same side
var cross2 = function(A, B) {
    var a1 = A.v1;
    var a2 = A.v2;
    var a3 = A.v3;
    var b1 = B.v1;
    var b2 = B.v2;
    var b3 = B.v3;
    // renamed variable names above, inconsistent with below
    var dXa = a1.x - b3.x;
    var dYa = a1.y - b3.y;
    var dXb = a2.x - b3.x;
    var dYb = a2.y - b3.y;
    var dXc = a3.x - b3.x;
    var dYc = a3.y - b3.y;
    var dX21 = b3.x - b2.x;
    var dY12 = b2.y - b3.y;
    var D = dY12 * (b1.x - b3.x) + dX21 * (b1.y - b3.y);
    var sa = dY12 * dXa + dX21 * dYa;
    var sb = dY12 * dXb + dX21 * dYb;
    var sc = dY12 * dXc + dX21 * dYc;
    var ta = (b3.y - b1.y) * dXa + (b1.x - b3.x) * dYa;
    var tb = (b3.y - b1.y) * dXb + (b1.x - b3.x) * dYb;
    var tc = (b3.y - b1.y) * dXc + (b1.x - b3.x) * dYc;
    if (D < 0) return ((sa >= 0 && sb >= 0 && sc >= 0) ||
                       (ta >= 0 && tb >= 0 && tc >= 0) ||
                       (sa+ta <= D && sb+tb <= D && sc+tc <= D));
    return ((sa <= 0 && sb <= 0 && sc <= 0) ||
            (ta <= 0 && tb <= 0 && tc <= 0) ||
            (sa+ta >= D && sb+tb >= D && sc+tc >= D));
}

export var trianglesIntersect = function(A, B) {
    return !(cross2(A, B) ||
             cross2(B, A));
}

export var triangleListsIntersect = function(As, Bs) {
    return cross(As, Bs).some(([A, B]) => trianglesIntersect(A, B));
}

// Used to represent both points and vectors for simplicity
export class Vector {
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }

    static fromPoints(start, end) {
        return new Vector(end.x - start.x, end.y - start.y);
    }

    print(xform, yform, prec = 4) {
        xform = xform || (x => x);
        yform = yform || (y => y);
        return `${xform(this.x).toFixed(prec)}, ${yform(this.y).toFixed(prec)}`;
    }

    multiply(multiplier) {
        return new Vector(this.x * multiplier, this.y * multiplier);
    }

    add(anotherVector) {
        return new Vector(this.x + anotherVector.x, this.y + anotherVector.y);
    }
}

// adapted from
// https://stackoverflow.com/questions/2049582/how-to-determine-if-a-point-is-in-a-2d-triangle/2049593#2049593

function sign(v1, v2, v3) {
    return (v1.x - v3.x) * (v2.y - v3.y) - (v2.x - v3.x) * (v1.y - v3.y);
}

export class Triangle {
    constructor(v1, v2, v3, coord, fillColor) {
        this.v1 = v1;
        this.v2 = v2;
        this.v3 = v3;

        this.fillColor = fillColor;
        this.coord = coord;
    }

    pointInside(pt) {
        const d1 = sign(pt, this.v1, this.v2),
              d2 = sign(pt, this.v2, this.v3),
              d3 = sign(pt, this.v3, this.v1);

        const has_neg = (d1 < 0) || (d2 < 0) || (d3 < 0);
        const has_pos = (d1 > 0) || (d2 > 0) || (d3 > 0);

        return !(has_neg && has_pos);
    }
}

// C
export class TriangleC extends Triangle {
    constructor(v1, v2, v3, coord) {
        super(v1, v2, v3, coord, 'blue');
    }

    split() {
        var vector_12 = Vector.fromPoints(this.v1, this.v2).multiply(GOLDEN_RATIO);
        var split_point_12 = this.v1.add(vector_12);

        var new_triangles = [];
        new_triangles.push(new TriangleC(this.v3, split_point_12, this.v2, 'C' + this.coord));
        new_triangles.push(new TriangleY(split_point_12, this.v3, this.v1, 'Y' + this.coord));

        return new_triangles;
    }
}

// D
export class TriangleD extends Triangle {
    constructor(v1, v2, v3, coord) {
        super(v1, v2, v3, coord, 'blue');
    }

    split() {
        var vector_13 = Vector.fromPoints(this.v1, this.v3).multiply(GOLDEN_RATIO);
        var split_point_13 = this.v1.add(vector_13);

        var new_triangles = [];
        new_triangles.push(new TriangleD(this.v2, this.v3, split_point_13, 'D' + this.coord));
        new_triangles.push(new TriangleX(split_point_13, this.v1, this.v2, 'X' + this.coord));

        return new_triangles;
    }
}

// X
export class TriangleX extends Triangle {
    constructor(v1, v2, v3, coord) {
        super(v1, v2, v3, coord, 'red');
    }

    split() {
        var vector_32 = Vector.fromPoints(this.v3, this.v2).multiply(GOLDEN_RATIO);
        var split_point_32 = this.v3.add(vector_32);

        var vector_31 = Vector.fromPoints(this.v3, this.v1).multiply(GOLDEN_RATIO);
        var split_point_31 = this.v3.add(vector_31);

        var new_triangles = [];
        new_triangles.push(new TriangleY(split_point_31, split_point_32, this.v3, 'Y' + this.coord));
        new_triangles.push(new TriangleC(split_point_32, split_point_31, this.v1, 'C' + this.coord));
        new_triangles.push(new TriangleX(split_point_32, this.v1, this.v2, 'X' + this.coord));

        return new_triangles;
    }
}

// Y
export class TriangleY extends Triangle {
    constructor(v1, v2, v3, coord) {
        super(v1, v2, v3, coord, 'red');
    }

    split() {
        var vector_21 = Vector.fromPoints(this.v2, this.v1).multiply(GOLDEN_RATIO);
        var split_point_21 = this.v2.add(vector_21);

        var vector_23 = Vector.fromPoints(this.v2, this.v3).multiply(GOLDEN_RATIO);
        var split_point_23 = this.v2.add(vector_23);

        var new_triangles = [];
        new_triangles.push(new TriangleY(split_point_23, this.v3, this.v1, 'Y' + this.coord));
        new_triangles.push(new TriangleD(split_point_23, this.v1, split_point_21, 'D' + this.coord));
        new_triangles.push(new TriangleX(split_point_21, this.v2, split_point_23, 'X' + this.coord));

        return new_triangles;
    }
}

export class Rhombus {
    constructor(v1, v2, v3, v4, coord, fillColor) {
        this.v1 = v1;
        this.v2 = v2;
        this.v3 = v3;
        this.v4 = v4;

        this.fillColor = fillColor;
        this.coord = coord;
    }
    getTriangles() {
        return [
            new Triangle(this.v1, this.v2, this.v3),
            new Triangle(this.v2, this.v3, this.v4)
        ];
    }
}

const rtri_neighbors = {
    CC: {
        0: {external: true, side: 1, hand: 'r'},
        1: {prefix: 'Y', enter: 1},
        2: {external: true, side: 0}
    },
    YC: {
        0: {external: true, side: 2},
        1: {prefix: 'C', enter: 1},
        2: {external: true, side: 1, hand: 'l'}
    },
    XD: {
        0: {external: true, side: 1},
        1: {external: true, side: 2, hand: 'r'},
        2: {prefix: 'D', enter: 2}
    },
    DD: {
        0: {external: true, side: 2, hand: 'l'},
        1: {external: true, side: 0},
        2: {prefix: 'X', enter: 2}
    },
    YX: {
        0: {external: true, side: 0, hand: 'r'},
        1: {prefix: 'C', enter: 1},
        2: {external: true, side: 2, hand: 'l'}
    },
    CX: {
        0: {external: true, side: 2, hand: 'r'},
        1: {prefix: 'Y', enter: 1},
        2: {prefix: 'X', enter: 1}
    },
    XX: {
        0: {external: true, side: 1},
        1: {prefix: 'C', enter: 2},
        2: {external: true, side: 0, hand: 'l'}
    },
    YY: {
        0: {external: true, side: 2},
        1: {external: true, side: 0, hand: 'r'},
        2: {prefix: 'D', enter: 1}
    },
    DY: {
        0: {external: true, side: 1, hand: 'l'},
        1: {prefix: 'Y', enter: 2},
        2: {prefix: 'X', enter: 2}
    },
    XY: {
        0: {external: true, side: 0, hand: 'l'},
        1: {external: true, side: 1, hand: 'r'},
        2: {prefix: 'D', enter: 2}
    }
};

const other_hand = {
    l: 'r',
    r: 'l'
};

const rtri_entries = {
    C: {
        0: {w: {part: 'C', side: 2}},
        1: {l: {part: 'Y', side: 2},
            r: {part: 'C', side: 0}},
        2: {w: {part: 'Y', side: 0}}
    },
    D: {
        0: {w: {part: 'D', side: 1}},
        1: {w: {part: 'X', side: 0}},
        2: {l: {part: 'D', side: 0},
            r: {part: 'X', side: 1}}
    },
    X: {
        0: {l: {part: 'X', side: 2},
            r: {part: 'Y', side: 0}},
        1: {w: {part: 'X', side: 0}},
        2: {l: {part: 'Y', side: 2},
            r: {part: 'C', side: 0}}
    },
    Y: {
        0: {l: {part: 'X', side: 0},
            r: {part: 'Y', side: 1}},
        1: {l: {part: 'D', side: 0},
            r: {part: 'X', side: 1}},
        2: {w: {part: 'Y', side: 0}}
    }
}

export function tatham_neighbor(coord, side) {
    if(coord.length < 2)
        throw new Error("no neighbor");
    const pre2 = coord.slice(0, 2);
    const neighbors = rtri_neighbors[pre2];
    console.assert(neighbors, 'unknown prefix', pre2);
    const nei = neighbors[side];
    var result;
    if(nei.external) {
        console.assert(nei.side !== undefined);
        const [parent, pside] = tatham_neighbor(coord.slice(1), nei.side);
        const enter = rtri_entries[parent[0]][pside];
        let part, side;
        if(nei.hand) {
            console.assert(enter.l);
            ({part, side} = enter[other_hand[nei.hand]]);
        } else {
            console.assert(enter.w);
            ({part, side} = enter.w);
        }
        return [part + parent, side];
    }
    else {
        return [nei.prefix + coord.slice(1), nei.enter];
    }
}

export function tatham_neighbor_or_null(coord, side) {
    try {
        return tatham_neighbor(coord, side)[0];
    }
    catch(xep) {
        console.warn('no neighbor', side, 'for', coord);
        return null;
    }
}

const shape_spec = {
    square: {
        sides: 4,
        offset: 0.5
    },
    pentagon: {
        sides: 5,
        offset: -0.25
    },
    hexagon: {
        sides: 6
    }
};

function regularPolygon(center, r, shape) {
    const {sides, offset} = shape_spec[shape];
    const thetas = range(offset || 0, sides, 1).map(v => v * 2 * Math.PI / sides);
    return thetas.map(theta => new Vector(Math.cos(theta)*r + center.x, Math.sin(theta)*r + center.y));
}

function triangulate(polygon) {
    return range(2, polygon.length).map(i => new Triangle(polygon[0], polygon[i-1], polygon[i], "N/A", "green"));
}

function generateTriangles(triangles, filt, enough) {
    const discarded = [];
    do {
        var new_triangles = [];
        for (var i = 0; i < triangles.length; i++) {
            var trig = triangles[i];
            new_triangles = new_triangles.concat(trig.split());
        }
        triangles = new_triangles.filter(tri => {
            if(filt(tri))
                return true;
            discarded.push(tri);
            return false;
        });
    }
    while(triangles.length && !enough(triangles));
    return [triangles, discarded];
}

function lighten(color) {
    switch(color) {
    case 'blue':
        return 'lightblue';
    case 'red':
        return 'pink';
    }
    console.log('unknown color to lighten', color);
    return color;
}

// unit-length edges
export function calculateBaseRhombuses() {
    const TAU = 2*Math.PI;
    const cos36_2 = Math.cos(TAU/10) / 2,
          sin36_2 = Math.sin(TAU/10) / 2;
    const cos72_2 = Math.cos(TAU/5) / 2,
          sin72_2 = Math.sin(TAU/5) / 2;
    // the easiest rotations to do the trig
    //      -------
    //     /     /
    //    /     /
    //   -------
    const rhomb0 = [
        new Vector(0.5 - cos72_2, -sin72_2),
        new Vector(0.5 + cos72_2, sin72_2),
        new Vector(cos72_2 - 0.5, sin72_2),
        new Vector(-0.5 - cos72_2, -sin72_2)
    ];
    const rhomb9 = [
        new Vector(0.5 + cos36_2, sin36_2),
        new Vector(cos36_2 - 0.5, sin36_2),
        new Vector(-0.5 - cos36_2, -sin36_2),
        new Vector(0.5 - cos36_2, -sin36_2)
    ];

    const rots = [0, TAU/5, TAU*2/5, TAU*3/5, TAU*4/5,
                  TAU*2/10, -TAU/10, -TAU*4/10, TAU*3/10, 0];
    return range(10)
        .map(i => (i < 5 ? rhomb0 : rhomb9).map(({x,y}) =>
            new Vector(
                x * Math.cos(rots[i]) - y * Math.sin(rots[i]),
                x * Math.sin(rots[i]) + y * Math.cos(rots[i])
            )));
}
let base_rhombuses = calculateBaseRhombuses();



export const truncate_float = prec => x => Math.abs(x) < 10 ** -prec ? 0..toFixed(prec) : x.toFixed(prec);

export function rhomb_key(vs, prec = 10) {
    if(vs instanceof Rhombus)
        vs = [vs.v1, vs.v2, vs.v3, vs.v4];
    const trunc = truncate_float(prec);
    
    // rotate point by 2 if corner 2, or typographically corner 3 is closer to 0 radians
    var do_it = false;
    const at2 = Math.abs(Math.atan2(vs[2].y, vs[2].x)),
          at0 = Math.abs(Math.atan2(vs[0].y, vs[0].x));
    if(Math.abs(at2 - at0) < 0.00001) { // or Math.abs(at0 - Math.PI / 2) < 0.00001
        const at3 = Math.abs(Math.atan2(vs[3].y, vs[3].x)),
              at1 = Math.abs(Math.atan2(vs[1].y, vs[1].x));
        if(at3 < at1)
            do_it = true;
    }
    else if(at2 < at0)
        do_it = true;
    if(do_it)
        vs = [...vs.slice(2), ...vs.slice(0, 2)];
    return vs.flatMap(v => [trunc(v.x), trunc(v.y)]).join(',');
}

export function calculateTrianglesBB(tris) {
    const tl = new Vector(
        min(tris, tri => min([tri.v1.x, tri.v2.x, tri.v3.x])),
        min(tris, tri => min([tri.v1.y, tri.v2.y, tri.v3.y])));
    const br = new Vector(
        max(tris, tri => max([tri.v1.x, tri.v2.x, tri.v3.x])),
        max(tris, tri => max([tri.v1.y, tri.v2.y, tri.v3.y])));
    return {tl, br};
}

export function calculateRhombusesBB(rhombs) {
    const tl = new Vector(
        min(rhombs, rhomb => min([rhomb.v1.x, rhomb.v2.x, rhomb.v3.x, rhomb.v4.x])),
        min(rhombs, rhomb => min([rhomb.v1.y, rhomb.v2.y, rhomb.v3.y, rhomb.v4.y])));
    const br = new Vector(
        max(rhombs, rhomb => max([rhomb.v1.x, rhomb.v2.x, rhomb.v3.x, rhomb.v4.x])),
        max(rhombs, rhomb => max([rhomb.v1.y, rhomb.v2.y, rhomb.v3.y, rhomb.v4.y])));
    return {tl, br};
}

export function scaleVector(tl, scale) {
    return v => {
        return new Vector(
            (v.x - tl.x) * scale,
            (v.y - tl.y) * scale);
    };
}

export function calculatePenroseTiling(minTiles, width, height, boundsShape, startTile, resolveRagged, center, r) {
    var ratio = Math.sin(36 * (Math.PI / 180)) / Math.sin(54 * (Math.PI / 180));
    var startri = null, hei;
    switch(startTile) {
    case 'C':
        hei = Math.min(width * ratio, height);
        startri = new TriangleC(new Vector(width / 2 - hei / 2 / ratio, hei / 2), new Vector(width / 2 + hei / 2 / ratio, 0), new Vector(width / 2 + hei / 2 / ratio, hei), startTile);
        break;
    case 'D':
        hei = Math.min(width * ratio, height);
        startri = new TriangleD(new Vector(width / 2 - hei / 2 / ratio, hei / 2), new Vector(width / 2 + hei / 2 / ratio, 0), new Vector(width / 2 + hei / 2 / ratio, hei), startTile);
        break;
    case 'X':
        hei = Math.min(width / 2.0 * ratio, height);
        startri = new TriangleX(new Vector(width / 2.0, 0), new Vector(width / 2.0 + hei / ratio, hei), new Vector(width / 2.0 - hei / ratio, hei), startTile);
        break;
    case 'Y':
        hei = Math.min(width / 2.0 * ratio, height);
        startri = new TriangleY(new Vector(width / 2.0, 0), new Vector(width / 2.0 + hei / ratio, hei), new Vector(width / 2.0 - hei / ratio, hei), startTile);
        break;
    }
    var triangles = [startri], polygon;
    if(center && r)
        polygon = regularPolygon(center, r, boundsShape);
    else {
        const [xmin, xmax] = extent([startri.v1.x, startri.v2.x, startri.v3.x]);
        const [ymin, ymax] = extent([startri.v1.y, startri.v2.y, startri.v3.y]);
        r = randomUniform(width/1000, width/8)();
        let r_tries = 5, found = false;
        do {
            let xrand = randomUniform(xmin + r, xmax - r),
                yrand = randomUniform(ymin + r, ymax - r);
            let c_tries = 10;
            do {
                center = new Vector(xrand(), yrand());
                polygon = regularPolygon(center, r, boundsShape);
                found = polygon.every(pt => startri.pointInside(pt));
            } while(--c_tries && !found);
            if(!found)
                r /= 2;
        }
        while(--r_tries && !found)
        if(!r_tries) {
            console.log("couldn't find polygon of radius", r, "inside", startri.v1.print(), startri.v2.print(), startri.v3.print());
            throw new Error("Couldn't find polygon inside triangle");
        }
    }
    const polyTris = triangulate(polygon);

    console.assert(!isNaN(minTiles));
    var discarded;
    [triangles, discarded] = generateTriangles(
        triangles,
        tri => polyTris.some(ptri => trianglesIntersect(ptri, tri)),
        tris => tris.length / 2 > minTiles);

    const trihash = {};
    for(var t of triangles)
        trihash[t.coord] = t;
    const disind = [];
    const find_tris = [];
    for(var [i, t] of triangles.entries()) {
        var oh = tatham_neighbor_or_null(t.coord, 0);
        var t2;
        if(!oh || !(t2 = trihash[oh])) {
            if(resolveRagged === "cull")
                disind.push(i);
            else if(resolveRagged === "fill") {
                var nei1 = tatham_neighbor_or_null(t.coord, 1),
                    nei2 = tatham_neighbor_or_null(t.coord, 2);
                if(oh && nei1 && nei2 && trihash[nei1] && trihash[nei2])
                    find_tris.push(oh);
                else
                    disind.push(i);
            }
        }
    }
    var found_tris = [];
    if(find_tris.length) {
        [found_tris] = generateTriangles(
            [startri],
            tri => find_tris.some(find => find.indexOf(tri.coord) === find.length - tri.coord.length),
            tris => !tris.length || tris[0].coord.length === find_tris[0].length);
        if(found_tris.length < find_tris.length) {
            console.log('did not find other halves of all sought triangles:');
            console.log('sought', find_tris);
            console.log('found', found_tris.map(({coord}) => coord));
        }
        for(const tri of found_tris)
            trihash[tri.coord] = tri;
        triangles.push(...found_tris);
    }
    const rhombhash = {};
    const tri2rhomb = {};
    for(var [i, t] of triangles.entries()) {
        var oh = tatham_neighbor_or_null(t.coord, 0);
        var t2;
        if(oh && (t2 = trihash[oh])) {
            const rhombcoord = [t.coord, oh].sort().join(',');
            if(rhombhash[rhombcoord])
                continue;
            else {
                tri2rhomb[t.coord] = rhombcoord;
                tri2rhomb[oh] = rhombcoord;
                const fillColor = (find_tris.includes(t.coord) || find_tris.includes(oh)) ?
                      lighten(t.fillColor) : t.fillColor;
                const rhombus = new Rhombus(t.v1, t.v2, t2.v1, t2.v2, rhombcoord, fillColor);
                rhombhash[rhombcoord] = {
                    rhombus,
                    tri1: t,
                    tri2: t2
                };
            }
        }
    }
    const culledTris = [];
    for(i = disind.length - 1; i >= 0; i--) {
        culledTris.push(triangles[disind[i]]);
        triangles.splice(disind[i], 1);
    }
    for(const [rhombcoord, {tri1, tri2, rhombus}] of Object.entries(rhombhash)) {
        const neighbors = [];
        var j = 0;
        // X1, X2, Y1, Y2 or C1, C2, D1, D2
        for(const tri of [tri1, tri2])
            for(const side of [1, 2]) {
                var nei = tatham_neighbor_or_null(tri.coord, side);
                const rhombnei = nei && tri2rhomb[nei] || null;
                neighbors.push(rhombnei);
            }
        rhombhash[rhombcoord].neighbors = neighbors;
    }
    const culledRhombs = [];
    if(resolveRagged === "cull") {
        var cullRhombs;
        do {
            cullRhombs = Object.values(rhombhash)
                .filter(({neighbors}) => neighbors.filter(n => n).length < 2);
            for(const {rhombus, neighbors} of cullRhombs) {
                culledRhombs.push(rhombus);
                for(nei of neighbors) {
                    if(!nei)
                        continue;
                    const entry = rhombhash[nei];
                    for(const i of range(4)) {
                        if(entry.neighbors[i] === rhombus.coord)
                            entry.neighbors[i] = null;
                    }
                }
                delete rhombhash[rhombus.coord];
            }
        }
        while(cullRhombs.length);
    }
    discarded.concat(culledTris).forEach(tri => tri.fillColor = 'none');
    var elengths = []
    for(const {rhombus: rh} of Object.values(rhombhash))
        for(const [v1, v2] of [[rh.v1,rh.v2], [rh.v2,rh.v3], [rh.v3, rh.v4], [rh.v4, rh.v1]])
            elengths.push(Math.hypot(v2.x - v1.x, v2.y - v1.y));
    const meanEdgeLength = mean(elengths);
    console.log('edge lengths mean', meanEdgeLength, 'stddev', deviation(elengths));
    const {tl, br} = calculateRhombusesBB(Object.values(rhombhash).map(({rhombus}) => rhombus));
    const scale = scaleVector(tl, 1/meanEdgeLength);
    for(const {rhombus: rh} of Object.values(rhombhash)) {
        rh.v1 = scale(rh.v1);
        rh.v2 = scale(rh.v2);
        rh.v3 = scale(rh.v3);
        rh.v4 = scale(rh.v4);
    }
    elengths = []
    for(const {rhombus: rh} of Object.values(rhombhash))
        for(const [v1, v2] of [[rh.v1,rh.v2], [rh.v2,rh.v3], [rh.v3, rh.v4], [rh.v4, rh.v1]])
            elengths.push(Math.hypot(v2.x - v1.x, v2.y - v1.y));
    console.log('edge lengths mean', mean(elengths), 'stddev', deviation(elengths));
    
    const rray = [];
    for(const {rhombus: rh} of Object.values(rhombhash)) {
        const cx = (rh.v1.x + rh.v3.x) / 2,
              cy = (rh.v1.y + rh.v3.y) / 2,
              cx2 = (rh.v2.x + rh.v4.x) / 2,
              cy2 = (rh.v2.y + rh.v4.y) / 2;
        console.assert(Math.abs(cx - cx2) < 1);
        console.assert(Math.abs(cy - cy2) < 1);
        rhombhash[rh.coord].center = new Vector(cx, cy);
        var vs = [
            new Vector(rh.v1.x - cx, rh.v1.y - cy),
            new Vector(rh.v2.x - cx, rh.v2.y - cy),
            new Vector(rh.v3.x - cx, rh.v3.y - cy),
            new Vector(rh.v4.x - cx, rh.v4.y - cy)];
        rhombhash[rh.coord].key = rhomb_key(vs);
    }

    const key_to_base = {};
    const base_to_key = [];
    for(const [i, rh] of base_rhombuses.entries()) {
        const key = rhomb_key(rh);
        key_to_base[key] = i;
        base_to_key.push(key);
    }
    const not_found = new Set(),
          bases_found = new Set();
    for(const rhombdef of Object.values(rhombhash)) {
        const base = key_to_base[rhombdef.key];
        if(base !== undefined) {
            bases_found.add(base);
            rhombdef.base = base;
        }
        else {
            not_found.add(rhombdef.key);
            rhombdef.base = null
        }
    }
    for(const nf of not_found)
        console.log('not found', nf);
    for(const base of range(10))
        if(!bases_found.has(base))
            console.log('unused', base_to_key[base]);
    
    return {
        center, r,
        polygon,
        robinsonTriangles: triangles,
        discardedTriangles: discarded,
        culledTriangles: culledTris,
        p3Rhombuses: rhombhash,
        culledRhombuses: culledRhombs,
        fillsIdentified: find_tris,
        fillsFound: found_tris,
        rhombBases: range(10),
        scaleFunction: scale
    };
}
