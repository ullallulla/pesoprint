import { stlToPreview } from '../lib/model-preview.ts';

/** Printed size used when a sample product doesn't list one (mm). */
const DEFAULT_SIZE: [number, number, number] = [50, 50, 50];

/**
 * A binary STL of a box `x` × `y` × `z` mm, standing on the build plate (Z up): 12 triangles,
 * wound counter-clockwise seen from outside, as slicers expect.
 */
export function boxStl(x: number, y: number, z: number): Uint8Array {
    const corner = (i: number): [number, number, number] => [i & 1 ? x : 0, i & 2 ? y : 0, i & 4 ? z : 0];
    // Each face as four corners (bit 1 = x, bit 2 = y, bit 4 = z), counter-clockwise from outside.
    const faces = [
        [0, 2, 3, 1], // bottom (z = 0, facing down)
        [4, 5, 7, 6], // top
        [0, 1, 5, 4], // front (y = 0)
        [2, 6, 7, 3], // back
        [0, 4, 6, 2], // left (x = 0)
        [1, 3, 7, 5], // right
    ];
    const triangles = faces.flatMap(([a, b, c, d]) => [
        [a!, b!, c!],
        [a!, c!, d!],
    ]);

    const data = new Uint8Array(84 + triangles.length * 50);
    const view = new DataView(data.buffer);
    data.set(new TextEncoder().encode('Pesoprint sample model (placeholder)'));
    view.setUint32(80, triangles.length, true);
    triangles.forEach((triangle, t) => {
        // The 12-byte normal stays zero: slicers and our preview recompute it.
        let offset = 84 + t * 50 + 12;
        for (const index of triangle) {
            for (const value of corner(index)) {
                view.setFloat32(offset, value, true);
                offset += 4;
            }
        }
    });
    return data;
}

export interface SampleModel {
    stl: Uint8Array;
    /** The 3D preview made from the STL, like the admin makes for uploads. */
    glb: Uint8Array;
}

/** The stand-in model for a sample product: a box at the product's printed size. */
export async function sampleModel(size?: readonly [number, number, number, ...number[]]): Promise<SampleModel> {
    const [x, y, z] = size ?? DEFAULT_SIZE;
    const stl = boxStl(x, y, z);
    const { glb } = await stlToPreview(stl);
    return { stl, glb };
}
