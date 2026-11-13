import { fileURLToPath } from 'node:url';

import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vite-plus/test';

import { createDatabase, runMigrations } from '../src/db/client.ts';
import { categories, productFiles, productImages, products, users } from '../src/db/schema.ts';
import { deleteOrphans, findOrphans, StorageMismatchError } from '../src/lib/storage-cleanup.ts';
import { createFakeStorage } from './helpers.ts';

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date('2026-11-13T12:00:00Z');
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3600 * 1000);

// Runs against a real Postgres. Start it with `vp run db:up` (local) — CI provides one as a service.
describe.skipIf(!url)('storage cleanup (integration)', () => {
    const { db, pool } = createDatabase(url ?? '');
    const CREATOR_ID = 'user_cleanup_creator';
    let storage: ReturnType<typeof createFakeStorage>;
    let productId: string;
    const keys = (id: string) => ({
        image: `products/${id}/images/0190b6a0-0000-7000-8000-000000000001.webp`,
        download: `products/${id}/files/0190b6a0-0000-7000-8000-000000000002.stl`,
        preview: `products/${id}/preview/0190b6a0-0000-7000-8000-000000000003.glb`,
    });

    async function resetCatalogue() {
        await db.delete(products);
        await db.delete(categories).where(sql`${categories.parentId} IS NOT NULL`);
        await db.delete(categories);
    }

    beforeAll(async () => {
        await runMigrations(db, fileURLToPath(new URL('../drizzle', import.meta.url)));
        await resetCatalogue();
        await db.delete(users).where(eq(users.id, CREATOR_ID));
        await db.insert(users).values({ id: CREATOR_ID, email: 'cleanup@example.com', role: 'creator' });
    });

    /** One product with an image, a download and a preview, all in storage and a week old. */
    beforeEach(async () => {
        await resetCatalogue();
        storage = createFakeStorage();
        const [category] = await db.insert(categories).values({ slug: 'hooks', name: 'Hooks' }).returning();
        const [product] = await db
            .insert(products)
            .values({ slug: 'hook', title: 'Hook', creatorId: CREATOR_ID, categoryId: category!.id })
            .returning();
        productId = product!.id;
        const used = keys(productId);
        await db
            .insert(productImages)
            .values({ productId, storageKey: used.image, alt: 'Hook', width: 800, height: 600, sizeBytes: 10 });
        await db.insert(productFiles).values([
            {
                productId,
                kind: 'download',
                format: 'stl',
                filename: 'hook.stl',
                storageKey: used.download,
                sizeBytes: 20,
            },
            { productId, kind: 'preview', format: 'glb', filename: 'hook.glb', storageKey: used.preview, sizeBytes: 5 },
        ]);
        storage.simulateUpload('public', used.image, 10, 'image/webp', undefined, hoursAgo(168));
        storage.simulateUpload('private', used.download, 20, 'model/stl', undefined, hoursAgo(168));
        storage.simulateUpload('public', used.preview, 5, 'model/gltf-binary', undefined, hoursAgo(168));
    });

    afterAll(async () => {
        await resetCatalogue();
        await db.delete(users).where(eq(users.id, CREATOR_ID));
        await pool.end();
    });

    test('finds old files no product uses, and nothing that is in use', async () => {
        const gone = keys('0190b6a0-0000-7000-8000-00000000dead');
        storage.simulateUpload('public', gone.image, 1000, 'image/webp', undefined, hoursAgo(48));
        storage.simulateUpload('private', gone.download, 2000, 'model/stl', undefined, hoursAgo(30));

        const report = await findOrphans(db, storage, { now: NOW });

        expect(report.referenced).toBe(3);
        expect(report.missing).toEqual([]);
        expect(report.orphans).toEqual([
            { bucket: 'private', key: gone.download, sizeBytes: 2000, lastModified: hoursAgo(30) },
            { bucket: 'public', key: gone.image, sizeBytes: 1000, lastModified: hoursAgo(48) },
        ]);

        await deleteOrphans(storage, report.orphans);
        expect(storage.deleted.toSorted()).toEqual([`private:${gone.download}`, `public:${gone.image}`]);
        expect(storage.has('public', keys(productId).image)).toBe(true);
    });

    test('a fresh upload not attached yet is kept: it may be in progress', async () => {
        const fresh = keys(productId).image.replace('000000000001', '000000000009');
        storage.simulateUpload('public', fresh, 1000, 'image/webp', undefined, hoursAgo(2));

        const report = await findOrphans(db, storage, { now: NOW });
        expect(report.orphans).toEqual([]);
        expect(report.recent).toBe(1);
    });

    test('a file in the wrong bucket is not counted as in use', async () => {
        // A download key in the public bucket isn't the download file.
        storage.simulateUpload('public', keys(productId).download, 20, 'model/stl', undefined, hoursAgo(168));
        const report = await findOrphans(db, storage, { now: NOW });
        expect(report.orphans.map((object) => `${object.bucket}:${object.key}`)).toEqual([
            `public:${keys(productId).download}`,
        ]);
    });

    test('files outside the folders the app uses are never touched', async () => {
        storage.simulateUpload('public', 'manual/logo.png', 100, 'image/png', undefined, hoursAgo(1000));
        const report = await findOrphans(db, storage, { now: NOW });
        expect(report.orphans).toEqual([]);
    });

    test('reports files the database uses that are missing from storage', async () => {
        await storage.delete('public', [keys(productId).preview]);
        const report = await findOrphans(db, storage, { now: NOW });
        expect(report.missing).toEqual([{ bucket: 'public', key: keys(productId).preview }]);
    });

    test("refuses when none of the database's files are in storage: wrong environment", async () => {
        const otherEnvironment = createFakeStorage();
        otherEnvironment.simulateUpload(
            'public',
            'products/x/images/y.webp',
            10,
            'image/webp',
            undefined,
            hoursAgo(99),
        );

        await expect(findOrphans(db, otherEnvironment, { now: NOW })).rejects.toThrow(StorageMismatchError);
    });
});
