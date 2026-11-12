import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, test } from 'vite-plus/test';

import { ModelParseError, parseStl, stlToPreview } from '../src/lib/model-preview.ts';
import { gridStl, tinyStl } from './seed-fixtures.ts';

const ASCII_STL = `solid part
  facet normal 0 0 1
    outer loop
      vertex 0 0 0
      vertex 10 0 0
      vertex 0 20 5
    endloop
  endfacet
endsolid part
`;

async function readGlb(glb: Uint8Array) {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
        .registerExtensions(ALL_EXTENSIONS)
        .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    return io.readBinary(glb);
}

describe('parseStl', () => {
    test('reads binary STL and turns Z-up into glTF Y-up', () => {
        // tinyStl: one triangle (0,0,0) (10,0,0) (0,10,0), lying flat.
        expect([...parseStl(new Uint8Array(tinyStl()))]).toEqual([0, 0, -0, 10, 0, -0, 0, 0, -10]);
    });

    test('reads ASCII STL', () => {
        expect([...parseStl(new TextEncoder().encode(ASCII_STL))]).toEqual([0, 0, -0, 10, 0, -0, 0, 5, -20]);
    });

    test.each([
        ['an image', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])],
        ['an ASCII STL without facets', new TextEncoder().encode('solid empty\nendsolid empty\n')],
        ['a truncated binary STL', new Uint8Array(tinyStl()).subarray(0, 120)],
    ])('refuses %s', (_name, data) => {
        expect(() => parseStl(data)).toThrow(ModelParseError);
    });
});

describe('stlToPreview', () => {
    test('a small model keeps every triangle, compressed into a GLB of the same size', async () => {
        const stl = gridStl(20);
        const preview = await stlToPreview(new Uint8Array(stl));

        expect(preview).toMatchObject({ sourceTriangles: 800, triangles: 800 });
        expect(new TextDecoder().decode(preview.glb.subarray(0, 4))).toBe('glTF');
        expect(preview.glb.byteLength).toBeLessThan(stl.byteLength / 4);

        const document = await readGlb(preview.glb);
        expect(
            document
                .getRoot()
                .listExtensionsUsed()
                .map((extension) => extension.extensionName),
        ).toEqual(expect.arrayContaining(['EXT_meshopt_compression', 'KHR_mesh_quantization']));
        // 20 × 20 mm in the STL's X and Y, which are glTF's X and Z.
        const { min, max } = getBounds(document.getRoot().listScenes()[0]!);
        expect(max[0] - min[0]).toBeCloseTo(20, 1);
        expect(max[2] - min[2]).toBeCloseTo(20, 1);
    });

    test('a detailed model is reduced to the triangle limit', async () => {
        const preview = await stlToPreview(new Uint8Array(gridStl(60)), { maxTriangles: 1000 });
        expect(preview.sourceTriangles).toBe(7200);
        expect(preview.triangles).toBeLessThanOrEqual(1000);
        expect(preview.triangles).toBeGreaterThan(100);
    });
});
