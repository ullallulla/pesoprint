import { describe, expect, test } from 'vite-plus/test';

import { boxStl, sampleModel } from '../src/db/seed-models.ts';
import { parseStl } from '../src/lib/model-preview.ts';

/** Signed volume of a triangle mesh (divergence theorem): positive when the triangles face outwards. */
function signedVolume(corners: Float32Array): number {
    let volume = 0;
    for (let i = 0; i < corners.length; i += 9) {
        const [ax, ay, az, bx, by, bz, cx, cy, cz] = corners.subarray(i, i + 9);
        volume += (ax! * (by! * cz! - bz! * cy!) - ay! * (bx! * cz! - bz! * cx!) + az! * (bx! * cy! - by! * cx!)) / 6;
    }
    return volume;
}

describe('boxStl', () => {
    test('is a binary STL of 12 triangles', () => {
        const stl = boxStl(20, 15, 12);
        expect(stl.byteLength).toBe(84 + 12 * 50);
        expect(new DataView(stl.buffer).getUint32(80, true)).toBe(12);
    });

    test('is a closed box of the given size, facing outwards (what slicers expect)', () => {
        const corners = parseStl(boxStl(20, 15, 12));
        expect(signedVolume(corners)).toBeCloseTo(20 * 15 * 12, 3);

        // Every edge is shared by exactly two triangles: no holes.
        const edges = new Map<string, number>();
        for (let t = 0; t < corners.length; t += 9) {
            const points = [0, 1, 2].map((p) => [...corners.subarray(t + p * 3, t + p * 3 + 3)].join(','));
            for (let e = 0; e < 3; e++) {
                const key = [points[e]!, points[(e + 1) % 3]!].sort((a, b) => a.localeCompare(b)).join('|');
                edges.set(key, (edges.get(key) ?? 0) + 1);
            }
        }
        expect([...edges.values()].every((count) => count === 2)).toBe(true);
    });
});

test('sampleModel makes the STL and its 3D preview, with a default size', async () => {
    const model = await sampleModel([90, 15, 12, 5]);
    expect(model.stl).toEqual(boxStl(90, 15, 12));
    expect(new TextDecoder().decode(model.glb.subarray(0, 4))).toBe('glTF');

    const fallback = await sampleModel();
    expect(fallback.stl).toEqual(boxStl(50, 50, 50));
});
