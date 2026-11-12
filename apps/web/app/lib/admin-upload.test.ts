import { describe, expect, test } from 'vite-plus/test';

import { mediaRequestSchema, uploadRequestFor } from './admin-upload';

const MB = 1024 * 1024;

describe('uploadRequestFor', () => {
    test('images are described by their content type', () => {
        expect(uploadRequestFor('image', { name: 'photo.webp', type: 'image/webp', size: 2 * MB })).toEqual({
            ok: true,
            upload: { target: 'image', contentType: 'image/webp', sizeBytes: 2 * MB },
        });
    });

    test('model files are described by their name, whatever type the browser guessed', () => {
        expect(uploadRequestFor('download', { name: 'Clip.STL', type: '', size: 1000 })).toEqual({
            ok: true,
            upload: { target: 'download', filename: 'Clip.STL', sizeBytes: 1000 },
        });
    });

    test.each([
        [
            'image',
            { name: 'scan.gif', type: 'image/gif', size: 100 },
            "scan.gif isn't a JPEG, PNG, WebP or AVIF image.",
        ],
        ['image', { name: 'huge.png', type: 'image/png', size: 11 * MB }, 'huge.png is 11.0 MB; the limit is 10.0 MB.'],
        [
            'download',
            { name: 'model.zip', type: 'application/zip', size: 100 },
            'Upload a stl, 3mf, step, stp, obj file.',
        ],
        ['preview', { name: 'model.stl', type: '', size: 100 }, 'The preview must be a .glb file.'],
        ['preview', { name: 'empty.glb', type: '', size: 0 }, 'empty.glb is empty.'],
    ] as const)('refuses %s %j before uploading', (target, file, message) => {
        expect(uploadRequestFor(target, file)).toEqual({ ok: false, message });
    });
});

test('the media route accepts only the three upload steps', () => {
    expect(
        mediaRequestSchema.safeParse({
            op: 'confirm-image',
            image: { key: 'products/p/images/i.webp', alt: 'A clip', width: 800, height: 600 },
        }).success,
    ).toBe(true);
    expect(mediaRequestSchema.safeParse({ op: 'delete-everything' }).success).toBe(false);
    expect(mediaRequestSchema.safeParse({ op: 'confirm-image', image: { key: 'k', alt: '' } }).success).toBe(false);
});
