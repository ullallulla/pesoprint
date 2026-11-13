import { fileURLToPath } from 'node:url';

import { apiErrorSchema, CLIENT_IP_HEADER, downloadLinkSchema, PROXY_SECRET_HEADER } from '@app/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vite-plus/test';

import { createDatabase, runMigrations } from '../src/db/client.ts';
import { categories, downloadEvents, productFiles, products, users, type NewProduct } from '../src/db/schema.ts';
import { createIpHasher } from '../src/lib/client-ip.ts';
import { createDownloadsService } from '../src/services/downloads.ts';
import { bearer, buildApp, createFakeStorage, tokens } from './helpers.ts';

const url = process.env.TEST_DATABASE_URL;
const UNKNOWN_ID = '0190a6d2-3b7e-7000-8000-000000000000';
const SECRET = 's'.repeat(32);
const NOW = new Date('2026-11-12T10:00:00Z');

// Runs against a real Postgres. Start it with `vp run db:up` (local) — CI provides one as a service.
describe.skipIf(!url)('downloads (integration)', () => {
    const { db, pool } = createDatabase(url ?? '');
    const CREATOR_ID = 'user_download_creator';
    const hashIp = createIpHasher(SECRET);
    const storage = createFakeStorage();
    const app = buildApp({
        downloads: createDownloadsService(db, storage, hashIp, { now: () => NOW }),
        internalApiSecret: SECRET,
    });
    let categoryId: string;

    async function resetCatalogue() {
        await db.delete(products);
        await db.delete(categories).where(sql`${categories.parentId} IS NOT NULL`);
        await db.delete(categories);
    }

    /** A product with one download file and one preview. Published free by default. */
    async function model(overrides: Partial<NewProduct> = {}) {
        const slug = overrides.slug ?? `model-${Math.random().toString(36).slice(2, 8)}`;
        const [product] = await db
            .insert(products)
            .values({
                slug,
                title: 'Hook',
                creatorId: CREATOR_ID,
                categoryId,
                status: 'published',
                publishedAt: new Date('2026-11-01T00:00:00Z'),
                digitalPriceCents: 0,
                license: 'cc_by',
                ...overrides,
            })
            .returning();
        const [download, preview] = await db
            .insert(productFiles)
            .values([
                {
                    productId: product!.id,
                    kind: 'download',
                    format: 'stl',
                    filename: 'Hook v2.stl',
                    storageKey: `products/${product!.id}/files/hook.stl`,
                    sizeBytes: 1000,
                },
                {
                    productId: product!.id,
                    kind: 'preview',
                    format: 'glb',
                    filename: 'hook-preview.glb',
                    storageKey: `products/${product!.id}/preview/hook.glb`,
                    sizeBytes: 100,
                },
            ])
            .returning();
        return { product: product!, download: download!, preview: preview! };
    }

    function download(fileId: string, headers: Record<string, string> = {}) {
        return app.request(`/api/downloads/${fileId}`, { method: 'POST', headers });
    }

    async function expectNotFound(res: Response) {
        expect(res.status).toBe(404);
        expect(apiErrorSchema.parse(await res.json()).error.message).toBe('File not found.');
    }

    const countOf = async (productId: string) =>
        (await db.select().from(products).where(eq(products.id, productId)))[0]!.downloadCount;

    beforeAll(async () => {
        await runMigrations(db, fileURLToPath(new URL('../drizzle', import.meta.url)));
        await resetCatalogue();
        await db.delete(users).where(eq(users.id, CREATOR_ID));
        await db.insert(users).values({ id: CREATOR_ID, email: 'creator@example.com', role: 'creator' });
    });

    beforeEach(async () => {
        await resetCatalogue();
        const [category] = await db.insert(categories).values({ slug: 'hooks', name: 'Hooks' }).returning();
        categoryId = category!.id;
    });

    afterAll(async () => {
        await resetCatalogue();
        await db.delete(users).where(eq(users.id, CREATOR_ID));
        await pool.end();
    });

    test('anyone gets a 5-minute link to a free model, and the download is counted', async () => {
        const { product, download: file } = await model();
        const before = (await db.select().from(products).where(eq(products.id, product.id)))[0]!;

        const res = await download(file.id, { [CLIENT_IP_HEADER]: '203.0.113.7', [PROXY_SECRET_HEADER]: SECRET });

        expect(res.status).toBe(200);
        expect(res.headers.get('cache-control')).toBe('no-store');
        const link = downloadLinkSchema.parse(await res.json());
        expect(link).toEqual({
            url: `https://storage.test/private/${file.storageKey}?filename=Hook+v2.stl&expires=300`,
            filename: 'Hook v2.stl',
            expiresAt: '2026-11-12T10:05:00.000Z',
        });

        const events = await db.select().from(downloadEvents).where(eq(downloadEvents.productId, product.id));
        expect(events).toEqual([
            expect.objectContaining({ fileId: file.id, userId: null, ipHash: hashIp('203.0.113.7', NOW) }),
        ]);
        const after = (await db.select().from(products).where(eq(products.id, product.id)))[0]!;
        expect(after.downloadCount).toBe(1);
        // A download isn't an edit.
        expect(after.updatedAt).toEqual(before.updatedAt);
    });

    test("a client can't choose its IP without the shared secret", async () => {
        const { product, download: file } = await model();
        await download(file.id, { [CLIENT_IP_HEADER]: '203.0.113.7', 'x-forwarded-for': '198.51.100.9' });

        const [event] = await db.select().from(downloadEvents).where(eq(downloadEvents.productId, product.id));
        expect(event?.ipHash).toBe(hashIp('198.51.100.9', NOW));
    });

    test('drafts, archived and paid models are not found, except for admins', async () => {
        const draft = await model({ status: 'draft', publishedAt: null });
        const archived = await model({ status: 'archived' });
        const paid = await model({ digitalPriceCents: 450, license: 'standard_digital' });

        for (const { download: file } of [draft, archived, paid]) {
            await expectNotFound(await download(file.id));
            await expectNotFound(await download(file.id, bearer(tokens.customer).headers));
            expect((await download(file.id, bearer(tokens.admin).headers)).status).toBe(200);
        }
        // Admins' downloads are logged but not counted.
        expect(await countOf(draft.product.id)).toBe(0);
        const adminEvents = await db.select().from(downloadEvents).where(eq(downloadEvents.productId, paid.product.id));
        expect(adminEvents).toHaveLength(1);
    });

    test('the preview, unknown files and bad ids are not downloads', async () => {
        const { preview } = await model();
        await expectNotFound(await download(preview.id));
        await expectNotFound(await download(UNKNOWN_ID));
        expect((await download('not-a-uuid')).status).toBe(400);
    });

    test('an invalid session is a 401, not a silent anonymous download', async () => {
        const { download: file } = await model();
        const res = await download(file.id, { authorization: 'Bearer expired' });
        expect(res.status).toBe(401);
    });

    test('503 while storage is not configured, and nothing is logged', async () => {
        const { product, download: file } = await model();
        const noStorage = buildApp({ downloads: createDownloadsService(db, null, hashIp), internalApiSecret: SECRET });

        expect((await noStorage.request(`/api/downloads/${file.id}`, { method: 'POST' })).status).toBe(503);
        expect(await db.select().from(downloadEvents).where(eq(downloadEvents.productId, product.id))).toEqual([]);
    });

    test('IP hashes are erased after 7 days, but the downloads stay', async () => {
        const { product, download: file } = await model();
        const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 3600 * 1000);
        await db.insert(downloadEvents).values([
            { productId: product.id, fileId: file.id, ipHash: 'old', createdAt: daysAgo(8) },
            { productId: product.id, fileId: file.id, ipHash: 'recent', createdAt: daysAgo(6) },
        ]);

        const service = createDownloadsService(db, storage, hashIp, { now: () => NOW });
        expect(await service.forgetOldIpHashes()).toBe(1);

        const events = await db.select().from(downloadEvents).where(eq(downloadEvents.productId, product.id));
        expect(new Set(events.map((event) => event.ipHash))).toEqual(new Set([null, 'recent']));
        expect(await service.forgetOldIpHashes()).toBe(0);
    });

    describe('rate limit', () => {
        const limited = buildApp({
            downloads: createDownloadsService(db, storage, hashIp, {
                now: () => NOW,
                limit: { count: 3, windowSeconds: 3600 },
            }),
            internalApiSecret: SECRET,
        });
        const from = (ip: string) => ({ [CLIENT_IP_HEADER]: ip, [PROXY_SECRET_HEADER]: SECRET });
        const get = (fileId: string, headers: Record<string, string>) =>
            limited.request(`/api/downloads/${fileId}`, { method: 'POST', headers });

        test('a visitor over the limit gets a 429 with Retry-After, and nothing is logged or counted', async () => {
            const { product, download: file } = await model();
            for (let i = 0; i < 3; i++) {
                expect((await get(file.id, from('203.0.113.1'))).status).toBe(200);
            }

            const res = await get(file.id, from('203.0.113.1'));
            expect(res.status).toBe(429);
            expect(res.headers.get('retry-after')).toBe('3600');
            const { error } = apiErrorSchema.parse(await res.json());
            expect(error).toMatchObject({ code: 'rate_limited' });
            expect(error.message).toBe("You've reached the limit of 3 downloads an hour. Try again in 60 minutes.");
            expect(await countOf(product.id)).toBe(3);
            expect(await db.select().from(downloadEvents).where(eq(downloadEvents.productId, product.id))).toHaveLength(
                3,
            );

            // Other visitors and admins aren't affected.
            expect((await get(file.id, from('203.0.113.2'))).status).toBe(200);
            expect((await get(file.id, { ...from('203.0.113.1'), ...bearer(tokens.admin).headers })).status).toBe(200);
        });

        test('only downloads within the window count', async () => {
            const { product, download: file } = await model();
            const twoHoursAgo = new Date(NOW.getTime() - 2 * 3600 * 1000);
            await db.insert(downloadEvents).values(
                Array.from({ length: 3 }, () => ({
                    productId: product.id,
                    fileId: file.id,
                    ipHash: hashIp('203.0.113.3', NOW),
                    createdAt: twoHoursAgo,
                })),
            );
            expect((await get(file.id, from('203.0.113.3'))).status).toBe(200);
        });

        test('downloads without a known IP are not limited', async () => {
            const { download: file } = await model();
            for (let i = 0; i < 5; i++) {
                expect((await get(file.id, {})).status).toBe(200);
            }
        });

        test('simultaneous downloads from one visitor cannot get past the limit', async () => {
            const { download: file } = await model();
            const statuses = await Promise.all(
                Array.from({ length: 6 }, async () => (await get(file.id, from('203.0.113.4'))).status),
            );
            expect(statuses.filter((status) => status === 200)).toHaveLength(3);
            expect(statuses.filter((status) => status === 429)).toHaveLength(3);
        });
    });
});
