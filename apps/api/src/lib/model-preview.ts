import { Document, Logger, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { meshopt, simplify, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

/**
 * Turns a model file into the public 3D preview: a reduced, compressed GLB.
 *
 * The preview is public even when the file is paid, so it is simplified to at most
 * {@link PREVIEW_MAX_TRIANGLES} triangles. That is plenty to look at, and for detailed models it is
 * far from the printable original. It also has no normals: viewers shade it flat, which suits
 * printed parts and keeps the file small.
 */

/** Upper limit for the preview's triangle count. */
export const PREVIEW_MAX_TRIANGLES = 100_000;
/** Larger STLs are skipped (an admin can upload a preview by hand): they would take too long and too much memory. */
export const PREVIEW_MAX_SOURCE_BYTES = 200 * 1024 * 1024;

export class ModelParseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ModelParseError';
    }
}

/**
 * Reads an STL (binary or ASCII) into a flat list of triangle corners, three numbers each.
 * STL is Z-up and glTF is Y-up, so the model is turned upright on the way: (x, y, z) → (x, z, −y).
 */
export function parseStl(data: Uint8Array): Float32Array<ArrayBuffer> {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    // Binary STL: 80-byte header, triangle count, then 50 bytes per triangle. Some binary files start
    // with "solid" too, so the size check comes first.
    if (data.byteLength >= 84) {
        const count = view.getUint32(80, true);
        if (count > 0 && data.byteLength === 84 + count * 50) {
            const positions = new Float32Array(count * 9);
            for (let triangle = 0; triangle < count; triangle++) {
                // Skip the 12-byte face normal; it is recomputed by the viewer.
                const offset = 84 + triangle * 50 + 12;
                for (let corner = 0; corner < 3; corner++) {
                    const at = offset + corner * 12;
                    const out = triangle * 9 + corner * 3;
                    positions[out] = view.getFloat32(at, true);
                    positions[out + 1] = view.getFloat32(at + 8, true);
                    positions[out + 2] = -view.getFloat32(at + 4, true);
                }
            }
            return positions;
        }
    }

    const text = new TextDecoder().decode(data.subarray(0, Math.min(data.byteLength, 1024)));
    if (!/^\s*solid\b/.test(text)) {
        throw new ModelParseError('Not an STL file.');
    }
    const values: number[] = [];
    const vertex = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
    for (const match of new TextDecoder().decode(data).matchAll(vertex)) {
        const [x, y, z] = [Number(match[1]), Number(match[2]), Number(match[3])];
        values.push(x, z, -y);
    }
    if (values.length === 0 || values.length % 9 !== 0 || values.some((value) => !Number.isFinite(value))) {
        throw new ModelParseError('The STL has no readable triangles.');
    }
    return new Float32Array(values);
}

export interface ModelPreview {
    glb: Uint8Array;
    sourceTriangles: number;
    triangles: number;
}

/** Builds the preview GLB from triangle corners as returned by {@link parseStl}. */
export async function buildPreview(
    positions: Float32Array<ArrayBuffer>,
    { maxTriangles = PREVIEW_MAX_TRIANGLES }: { maxTriangles?: number } = {},
): Promise<ModelPreview> {
    if (!positions.every(Number.isFinite)) {
        throw new ModelParseError('The model has invalid coordinates.');
    }
    await Promise.all([MeshoptSimplifier.ready, MeshoptEncoder.ready]);

    // Only warnings: the default logger reports every step of every transform.
    const document = new Document().setLogger(new Logger(Logger.Verbosity.WARN));
    const buffer = document.createBuffer();
    const position = document.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer);
    const primitive = document.createPrimitive().setAttribute('POSITION', position);
    const mesh = document.createMesh('model').addPrimitive(primitive);
    document.createScene().addChild(document.createNode('model').setMesh(mesh));

    const sourceTriangles = positions.length / 9;
    await document.transform(
        // Joins the corners that STL repeats for every triangle, so the simplifier sees a connected mesh.
        weld(),
        simplify({
            simplifier: MeshoptSimplifier,
            ratio: Math.min(1, maxTriangles / sourceTriangles),
            // Allowed deviation, relative to the model's size. Lenient, so the triangle target is reached.
            error: 0.01,
        }),
        meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
    );

    const indices = document.getRoot().listMeshes()[0]?.listPrimitives()[0]?.getIndices();
    const triangles = (indices?.getCount() ?? 0) / 3;
    if (triangles === 0) {
        throw new ModelParseError('The model has no triangles.');
    }

    const io = new NodeIO()
        .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
        .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
    return { glb: await io.writeBinary(document), sourceTriangles, triangles };
}

/** STL file contents → preview GLB. Throws {@link ModelParseError} if the file can't be read. */
export async function stlToPreview(data: Uint8Array, options?: { maxTriangles?: number }): Promise<ModelPreview> {
    return buildPreview(parseStl(data), options);
}
