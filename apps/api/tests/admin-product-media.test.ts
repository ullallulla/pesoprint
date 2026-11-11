import { fileURLToPath } from 'node:url';

import {
    adminProductFileSchema,
    adminProductImageSchema,
    adminProductSchema,
    apiErrorSchema,
    uploadTicketSchema,
    type UploadTicket,
} from '@app/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vite-plus/test';

import { createDatabase, runMigrations } from '../src/db/client.ts';
import { categories, productFiles, productImages, products, users } from '../src/db/schema.ts';
import { createProductMediaService } from '../src/services/product-media.ts';
import { createProductsService } from '../src/services/products.ts';
import { bearer, buildApp, createFakeStorage, tokens } from './helpers.ts';

const UNKNOWN_ID = '0190a6d2-3b7e-7000-8000-000000000000';

describe('admin product media routes: auth', () => {
    const app = buildApp();

    test.each([
        ['POST', `/api/admin/products/${UNKNOWN_ID}/uploads`],
        ['POST', `/api/admin/products/${UNKNOWN_ID}/images`],
        ['PATCH', `/api/admin/products/${UNKNOWN_ID}/images/${UNKNOWN_ID}`],
        ['DELETE', `/api/admin/products/${UNKNOWN_ID}/images/${UNKNOWN_ID}`],
        ['POST', `/api/admin/products/${UNKNOWN_ID}/files`],
        ['DELETE', `/api/admin/products/${UNKNOWN_ID}/files/${UNKNOWN_ID}`],
    ])('%s %s is admin only', async (method, path) => {
        expect((await app.request(path, { method })).status).toBe(401);
        expect((await app.request(path, { method, ...bearer(tokens.customer) })).status).toBe(403);
    });
});

const url = process.env.TEST_DATABASE_URL;

// Runs against a real Postgres. Start it with `vp run db:up` (local) — CI provides one as a service.
describe.skipIf(!url)('admin product media routes (integration)', () => {
    const { db, pool } = createDatabase(url ?? '');
    const storage = createFakeStorage();
    const app = buildApp({
        products: createProductsService(db, storage),
        productMedia: createProductMediaService(db, storage),
    });
    const ADMIN_ID = 'user_admin';
    let productId: string;

    function call(method: string, path: string, body?: unknown) {
        return app.request(`/api/admin/products${path}`, {
            method,
            headers: { ...bearer(tokens.admin).headers, 'content-type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
    }

    async function expectError(res: Response, status: number, code: string) {
        expect(res.status).toBe(status);
        const { error } = apiErrorSchema.parse(await res.json());
        expect(error.code).toBe(code);
        return error;
    }

    async function startUpload(body: Record<string, unknown>, id = productId): Promise<UploadTicket> {
        const res = await call('POST', `/${id}/uploads`, body);
        expect(res.status).toBe(201);
        return uploadTicketSchema.parse(await res.json());
    }

    /** The full flow: ticket → (fake) PUT → confirm. */
    async function uploadImage(alt = 'Front view') {
        const ticket = await startUpload({ target: 'image', contentType: 'image/webp', sizeBytes: 5000 });
        storage.simulateUpload('public', ticket.key, 5000, 'image/webp');
        const res = await call('POST', `/${productId}/images`, { key: ticket.key, alt, width: 1200, height: 900 });
        expect(res.status).toBe(201);
        return adminProductImageSchema.parse(await res.json());
    }

    async function uploadFile(target: 'download' | 'preview', filename: string) {
        const ticket = await startUpload({ target, filename, sizeBytes: 9000 });
        storage.simulateUpload(
            target === 'download' ? 'private' : 'public',
            ticket.key,
            9000,
            ticket.headers['content-type']!,
        );
        const res = await call('POST', `/${productId}/files`, { key: ticket.key, filename });
        expect(res.status).toBe(201);
        return adminProductFileSchema.parse(await res.json());
    }

    async function resetCatalogue() {
        await db.delete(products);
        await db.delete(categories).where(sql`${categories.parentId} IS NOT NULL`);
        await db.delete(categories);
    }

    beforeAll(async () => {
        await runMigrations(db, fileURLToPath(new URL('../drizzle', import.meta.url)));
        await resetCatalogue();
        await db.delete(users).where(eq(users.id, ADMIN_ID));
        await db.insert(users).values({ id: ADMIN_ID, email: 'admin@example.com', role: 'admin' });
    });

    beforeEach(async () => {
        await resetCatalogue();
        const [category] = await db.insert(categories).values({ slug: 'toys', name: 'Toys' }).returning();
        const [product] = await db
            .insert(products)
            .values({
                slug: 'dragon',
                title: 'Dragon',
                creatorId: ADMIN_ID,
                categoryId: category!.id,
                digitalPriceCents: 0,
                license: 'cc_by',
            })
            .returning();
        productId = product!.id;
    });

    afterAll(async () => {
        await resetCatalogue();
        await db.delete(users).where(eq(users.id, ADMIN_ID));
        await pool.end();
    });

    describe('starting an upload', () => {
        test('images go to the public bucket under the product, with the type locked in', async () => {
            const ticket = await startUpload({ target: 'image', contentType: 'image/png', sizeBytes: 5000 });
            expect(ticket.key).toMatch(new RegExp(`^products/${productId}/images/[0-9a-f-]{36}\\.png$`));
            expect(ticket.url).toContain('https://storage.test/public/');
            expect(ticket.headers).toEqual({ 'content-type': 'image/png' });
        });

        test('downloads go to the private bucket; the server picks the content type from the format', async () => {
            const ticket = await startUpload({ target: 'download', filename: 'Bracket.STP', sizeBytes: 5000 });
            expect(ticket.key).toMatch(/\/files\/[0-9a-f-]{36}\.step$/);
            expect(ticket.url).toContain('https://storage.test/private/');
            expect(ticket.headers).toEqual({ 'content-type': 'model/step' });
        });

        test('400 for an unsupported file, 404 for an unknown product', async () => {
            await expectError(
                await call('POST', `/${productId}/uploads`, { target: 'download', filename: 'x.blend', sizeBytes: 1 }),
                400,
                'validation_failed',
            );
            const error = await expectError(
                await call('POST', `/${UNKNOWN_ID}/uploads`, { target: 'preview', filename: 'p.glb', sizeBytes: 1 }),
                404,
                'not_found',
            );
            expect(error.message).toBe('Product not found.');
        });

        test('503 while storage is not configured', async () => {
            const noStorage = buildApp({ productMedia: createProductMediaService(db, null) });
            const res = await noStorage.request(`/api/admin/products/${productId}/uploads`, {
                method: 'POST',
                headers: { ...bearer(tokens.admin).headers, 'content-type': 'application/json' },
                body: JSON.stringify({ target: 'image', contentType: 'image/webp', sizeBytes: 10 }),
            });
            const error = await expectError(res, 503, 'internal_error');
            expect(error.message).toMatch(/not configured/);
        });
    });

    describe('images', () => {
        test('are appended to the gallery with public URLs and the size from storage', async () => {
            const first = await uploadImage('Front');
            const second = await uploadImage('Side');

            expect([first.position, second.position]).toEqual([0, 1]);
            expect(first.url).toMatch(/^https:\/\/assets\.test\/products\//);
            expect(first.sizeBytes).toBe(5000);

            const product = adminProductSchema.parse(await (await call('GET', `/${productId}`)).json());
            expect(product.images.map((image) => image.alt)).toEqual(['Front', 'Side']);
        });

        test('confirming before uploading is refused', async () => {
            const ticket = await startUpload({ target: 'image', contentType: 'image/webp', sizeBytes: 5000 });
            const error = await expectError(
                await call('POST', `/${productId}/images`, { key: ticket.key, alt: 'x', width: 10, height: 10 }),
                400,
                'validation_failed',
            );
            expect(error.issues?.[0]?.path).toBe('key');
        });

        test("a key from another product or another kind of upload can't be attached", async () => {
            const download = await startUpload({ target: 'download', filename: 'a.stl', sizeBytes: 10 });
            storage.simulateUpload('private', download.key, 10, 'model/stl');
            const wrongKind = await expectError(
                await call('POST', `/${productId}/images`, { key: download.key, alt: 'x', width: 10, height: 10 }),
                400,
                'validation_failed',
            );
            expect(wrongKind.message).toMatch(/not an image upload for this product/);

            const foreignKey = `products/${UNKNOWN_ID}/images/${UNKNOWN_ID}.webp`;
            const foreign = await expectError(
                await call('POST', `/${productId}/images`, { key: foreignKey, alt: 'x', width: 10, height: 10 }),
                400,
                'validation_failed',
            );
            expect(foreign.message).toMatch(/not an image upload for this product/);
        });

        test('an upload of the wrong type is rejected and deleted from storage', async () => {
            const ticket = await startUpload({ target: 'image', contentType: 'image/webp', sizeBytes: 5000 });
            storage.simulateUpload('public', ticket.key, 5000, 'text/html');

            await expectError(
                await call('POST', `/${productId}/images`, { key: ticket.key, alt: 'x', width: 10, height: 10 }),
                400,
                'validation_failed',
            );
            expect(storage.has('public', ticket.key)).toBe(false);
        });

        test('attaching the same upload twice is a 409', async () => {
            const ticket = await startUpload({ target: 'image', contentType: 'image/webp', sizeBytes: 5000 });
            storage.simulateUpload('public', ticket.key, 5000, 'image/webp');
            const body = { key: ticket.key, alt: 'x', width: 10, height: 10 };

            expect((await call('POST', `/${productId}/images`, body)).status).toBe(201);
            await expectError(await call('POST', `/${productId}/images`, body), 409, 'conflict');
        });

        test('alt text and position can be changed', async () => {
            const image = await uploadImage();
            const res = await call('PATCH', `/${productId}/images/${image.id}`, {
                alt: 'Dragon on a desk',
                position: 5,
            });
            expect(adminProductImageSchema.parse(await res.json())).toMatchObject({
                alt: 'Dragon on a desk',
                position: 5,
            });

            const missing = await expectError(
                await call('PATCH', `/${productId}/images/${UNKNOWN_ID}`, { alt: 'x' }),
                404,
                'not_found',
            );
            expect(missing.message).toBe('Image not found.');
        });

        test('deleting removes the row and the stored object', async () => {
            const image = await uploadImage();
            const [row] = await db.select().from(productImages).where(eq(productImages.id, image.id));

            expect((await call('DELETE', `/${productId}/images/${image.id}`)).status).toBe(204);
            expect(storage.has('public', row!.storageKey)).toBe(false);
            expect(await db.select().from(productImages).where(eq(productImages.id, image.id))).toEqual([]);
        });
    });

    describe('model files', () => {
        test('a download is private: no URL', async () => {
            const file = await uploadFile('download', 'Dragon.STL');
            expect(file).toMatchObject({ kind: 'download', format: 'stl', filename: 'Dragon.STL', url: null });
        });

        test('a preview is public, and a new preview replaces the old one (row and object)', async () => {
            const first = await uploadFile('preview', 'v1.glb');
            expect(first.url).toMatch(/^https:\/\/assets\.test\//);
            const [firstRow] = await db.select().from(productFiles).where(eq(productFiles.id, first.id));

            const second = await uploadFile('preview', 'v2.glb');

            const previews = await db.select().from(productFiles).where(eq(productFiles.kind, 'preview'));
            expect(previews.map((file) => file.id)).toEqual([second.id]);
            expect(storage.has('public', firstRow!.storageKey)).toBe(false);
        });

        test('several downloads are kept in upload order', async () => {
            const stl = await uploadFile('download', 'body.stl');
            const threeMf = await uploadFile('download', 'body.3mf');
            expect([stl.position, threeMf.position]).toEqual([0, 1]);
        });
    });

    describe('published products keep what publishing requires', () => {
        async function publish() {
            const res = await call('POST', `/${productId}/publish`);
            expect(res.status).toBe(200);
        }

        test('the last image cannot be deleted, but an extra one can', async () => {
            const first = await uploadImage();
            await uploadFile('download', 'dragon.stl');
            await publish();

            const error = await expectError(await call('DELETE', `/${productId}/images/${first.id}`), 409, 'conflict');
            expect(error.issues?.map((issue) => issue.path)).toEqual(['images']);

            const second = await uploadImage();
            expect((await call('DELETE', `/${productId}/images/${second.id}`)).status).toBe(204);
        });

        test('the last download cannot be deleted, but the preview can', async () => {
            await uploadImage();
            const download = await uploadFile('download', 'dragon.stl');
            const preview = await uploadFile('preview', 'preview.glb');
            await publish();

            const error = await expectError(
                await call('DELETE', `/${productId}/files/${download.id}`),
                409,
                'conflict',
            );
            expect(error.issues?.map((issue) => issue.path)).toEqual(['files']);
            expect((await call('DELETE', `/${productId}/files/${preview.id}`)).status).toBe(204);
        });
    });

    test('deleting a draft also deletes its stored files from both buckets', async () => {
        await uploadImage();
        await uploadFile('download', 'dragon.stl');
        const keys = await db.select({ key: productFiles.storageKey }).from(productFiles);
        const images = await db.select({ key: productImages.storageKey }).from(productImages);

        expect((await call('DELETE', `/${productId}`)).status).toBe(204);
        expect(storage.has('private', keys[0]!.key)).toBe(false);
        expect(storage.has('public', images[0]!.key)).toBe(false);
    });
});
