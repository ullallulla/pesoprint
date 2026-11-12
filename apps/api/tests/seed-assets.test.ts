import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test';

import { loadSeedAssets } from '../src/db/seed-assets.ts';
import { TINY_PNG, tinyStl, validSource, writeAsset } from './seed-fixtures.ts';

describe('loadSeedAssets', () => {
    let dir: string;
    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), 'seed-assets-'));
    });
    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    test('returns nothing when the folder does not exist', async () => {
        expect(await loadSeedAssets(join(dir, 'missing'))).toEqual([]);
    });

    test('reads a model folder: source, images (sorted, with dimensions) and model files', async () => {
        await writeAsset(dir, 'cable-clip', validSource, {
            'render-2.png': TINY_PNG,
            'render-1.png': TINY_PNG,
            'Cable Clip.STL': tinyStl(),
            'README.md': Buffer.from('Notes are allowed and not uploaded.'),
        });

        const [asset] = await loadSeedAssets(dir);
        expect(asset).toMatchObject({
            slug: 'cable-clip',
            source: { title: 'Cable Clip', description: '', featured: false },
            images: [
                { filename: 'render-1.png', contentType: 'image/png', width: 1, height: 1 },
                { filename: 'render-2.png', contentType: 'image/png', width: 1, height: 1 },
            ],
            files: [
                { filename: 'Cable Clip.STL', kind: 'download', format: 'stl', contentType: 'model/stl' },
                // Made from the STL, for the 3D viewer.
                {
                    filename: 'Cable Clip-preview.glb',
                    kind: 'preview',
                    format: 'glb',
                    contentType: 'model/gltf-binary',
                },
            ],
        });
    });

    test('keeps a hand-made preview, and makes none for a "no derivatives" licence', async () => {
        const glb = Buffer.from('glTF hand-made');
        await writeAsset(dir, 'own-preview', validSource, { 'clip.stl': tinyStl(), 'clip.glb': glb });
        await writeAsset(dir, 'no-derivatives', { ...validSource, license: 'cc_by_nd' }, { 'clip.stl': tinyStl() });

        const assets = await loadSeedAssets(dir);
        const previews = (slug: string) =>
            assets.find((asset) => asset.slug === slug)!.files.filter((file) => file.kind === 'preview');
        expect(previews('own-preview')).toEqual([
            expect.objectContaining({ filename: 'clip.glb', body: new Uint8Array(glb) }),
        ]);
        expect(previews('no-derivatives')).toEqual([]);
    });

    test.each([
        ['a folder name that is not a slug', 'Cable Clip', validSource, {}, /must be a slug/],
        ['an unknown field in source.json', 'cable-clip', { ...validSource, colour: 'red' }, {}, /invalid source.json/],
        ['an unknown licence', 'cable-clip', { ...validSource, license: 'mit' }, {}, /invalid source.json/],
        [
            'an unsupported file',
            'cable-clip',
            validSource,
            { 'model.blend': Buffer.from('x') },
            /unsupported file type/,
        ],
    ])('fails clearly on %s', async (_, slug, source, files, message) => {
        await writeAsset(dir, slug, source, files);
        await expect(loadSeedAssets(dir)).rejects.toThrow(message);
    });

    test('fails when source.json is missing', async () => {
        await mkdir(join(dir, 'cable-clip'));
        await expect(loadSeedAssets(dir)).rejects.toThrow(/seed-assets\/cable-clip: could not read source.json/);
    });
});
