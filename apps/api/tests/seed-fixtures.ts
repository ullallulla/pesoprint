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
