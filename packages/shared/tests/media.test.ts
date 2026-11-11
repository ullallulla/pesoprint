import { describe, expect, test } from 'vite-plus/test';

import { createUploadSchema, fileExtension, MAX_UPLOAD_BYTES } from '../src/index.ts';

describe('fileExtension', () => {
    test.each([
        ['dragon.STL', 'stl'],
        ['my.model.3mf', '3mf'],
        ['noext', ''],
        ['.hidden', ''],
    ])('%s → %j', (name, ext) => {
        expect(fileExtension(name)).toBe(ext);
    });
});

describe('createUploadSchema', () => {
    test.each([
        { target: 'image', contentType: 'image/webp', sizeBytes: 1000 },
        { target: 'download', filename: 'Dragon.STL', sizeBytes: 1000 },
        { target: 'download', filename: 'bracket.stp', sizeBytes: 1000 },
        { target: 'preview', filename: 'preview.glb', sizeBytes: 1000 },
    ])('accepts $target $filename$contentType', (input) => {
        expect(createUploadSchema.safeParse(input).success).toBe(true);
    });

    test.each([
        ['an unsupported image type', { target: 'image', contentType: 'image/gif', sizeBytes: 1000 }],
        ['an unsupported model format', { target: 'download', filename: 'model.blend', sizeBytes: 1000 }],
        ['a preview that is not GLB', { target: 'preview', filename: 'preview.stl', sizeBytes: 1000 }],
        ['an empty file', { target: 'download', filename: 'model.stl', sizeBytes: 0 }],
        [
            'a preview over the size limit',
            { target: 'preview', filename: 'preview.glb', sizeBytes: MAX_UPLOAD_BYTES.preview + 1 },
        ],
        ['an unknown target', { target: 'video', filename: 'a.mp4', sizeBytes: 1000 }],
    ])('rejects %s', (_, input) => {
        expect(createUploadSchema.safeParse(input).success).toBe(false);
    });
});
