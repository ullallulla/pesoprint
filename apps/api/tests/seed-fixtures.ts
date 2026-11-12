import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** A 1×1 PNG. */
export const TINY_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
);

/** A binary STL with one triangle. */
export function tinyStl(): Buffer {
    const buffer = Buffer.alloc(84 + 50);
    buffer.writeUInt32LE(1, 80);
    [0, 0, 1, 0, 0, 0, 10, 0, 0, 0, 10, 0].forEach((value, i) => buffer.writeFloatLE(value, 84 + i * 4));
    return buffer;
}

export async function writeAsset(dir: string, slug: string, source: object, files: Record<string, Buffer> = {}) {
    await mkdir(join(dir, slug), { recursive: true });
    await writeFile(join(dir, slug, 'source.json'), JSON.stringify(source));
    for (const [name, body] of Object.entries(files)) {
        await writeFile(join(dir, slug, name), body);
    }
}

export const validSource = {
    title: 'Cable Clip',
    category: 'cable-management',
    digitalPriceCents: 0,
    license: 'cc_by',
};

/**
 * A binary STL of a wavy square surface: `cells`² squares of two triangles each. The waves keep the
 * simplifier from flattening it to two triangles, so a reduced preview still has a predictable size.
 */
export function gridStl(cells: number): Buffer {
    const triangles = cells * cells * 2;
    const buffer = Buffer.alloc(84 + triangles * 50);
    buffer.writeUInt32LE(triangles, 80);
    const height = (x: number, y: number) => Math.sin(x / 3) * Math.cos(y / 4) * 2;
    let offset = 84;
    const corner = (x: number, y: number) => [x, y, height(x, y)];
    for (let x = 0; x < cells; x++) {
        for (let y = 0; y < cells; y++) {
            for (const triangle of [
                [corner(x, y), corner(x + 1, y), corner(x + 1, y + 1)],
                [corner(x, y), corner(x + 1, y + 1), corner(x, y + 1)],
            ]) {
                offset += 12; // face normal left at zero, as many exporters do
                for (const value of triangle.flat()) {
                    buffer.writeFloatLE(value, offset);
                    offset += 4;
                }
                offset += 2;
            }
        }
    }
    return buffer;
}
