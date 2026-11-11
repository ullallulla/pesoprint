import { describe, expect, test } from 'vite-plus/test';

import { loadEnv } from '../src/env.ts';
import { createS3Storage } from '../src/integrations/s3.ts';

// Presigning is local crypto, so these run without a real bucket.
describe('S3 storage', () => {
    const storage = createS3Storage({
        endpoint: 'https://account123.r2.cloudflarestorage.com',
        region: 'auto',
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
        buckets: { public: 'pesoprint-public', private: 'pesoprint-private' },
        publicBaseUrl: 'https://assets.example.com/',
        uploadUrlTtlSeconds: 600,
    });

    test('presigns a PUT that is locked to the announced type and size', async () => {
        const upload = await storage.presignUpload({
            bucket: 'private',
            key: 'products/abc/files/model.stl',
            contentType: 'model/stl',
            sizeBytes: 1234,
        });
        const url = new URL(upload.url);

        expect(url.origin + url.pathname).toBe(
            'https://account123.r2.cloudflarestorage.com/pesoprint-private/products/abc/files/model.stl',
        );
        expect(url.searchParams.get('X-Amz-Expires')).toBe('600');
        expect(url.searchParams.get('X-Amz-SignedHeaders')?.split(';')).toEqual(
            expect.arrayContaining(['content-length', 'content-type', 'host']),
        );
        expect(upload.headers).toEqual({ 'content-type': 'model/stl' });
        expect(upload.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    test('adds no checksum the browser could not reproduce', async () => {
        const { url } = await storage.presignUpload({
            bucket: 'public',
            key: 'products/abc/images/a.webp',
            contentType: 'image/webp',
            sizeBytes: 10,
        });
        expect(url.toLowerCase()).not.toContain('checksum');
    });

    test('builds public URLs from the base URL', () => {
        expect(storage.publicUrl('products/abc/images/a b.webp')).toBe(
            'https://assets.example.com/products/abc/images/a%20b.webp',
        );
    });
});

describe('storage settings', () => {
    const base = { DATABASE_URL: 'postgres://u:p@localhost/db', CLERK_SECRET_KEY: 'sk_test_x' };
    const storage = {
        S3_ENDPOINT: 'https://account123.r2.cloudflarestorage.com',
        S3_ACCESS_KEY_ID: 'key',
        S3_SECRET_ACCESS_KEY: 'secret',
        S3_PUBLIC_BUCKET: 'public',
        S3_PRIVATE_BUCKET: 'private',
        PUBLIC_ASSETS_URL: 'https://assets.example.com',
    };

    test('are optional', () => {
        expect(loadEnv(base).S3_ENDPOINT).toBeUndefined();
    });

    test('are accepted when complete', () => {
        expect(loadEnv({ ...base, ...storage })).toMatchObject({ S3_REGION: 'auto', S3_PUBLIC_BUCKET: 'public' });
    });

    test('fail fast when only some are set', () => {
        const { S3_PRIVATE_BUCKET: _, PUBLIC_ASSETS_URL: __, ...partial } = storage;
        expect(() => loadEnv({ ...base, ...partial })).toThrow(/S3_PRIVATE_BUCKET, PUBLIC_ASSETS_URL/);
    });
});
