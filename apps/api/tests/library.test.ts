import { fileURLToPath } from 'node:url';

import { libraryItemSchema, librarySchema } from '@app/shared';
import { inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vite-plus/test';

import { createDatabase, runMigrations } from '../src/db/client.ts';
import {
    categories,
    entitlements,
    orders,
    productFiles,
    productImages,
    products,
    users,
    type NewProduct,
} from '../src/db/schema.ts';
import { createLibraryService } from '../src/services/library.ts';
import { bearer, buildApp, createFakeStorage, tokens } from './helpers.ts';

describe('the library without a database', () => {
    const app = buildApp();

    test('needs a signed-in user', async () => {
        expect((await app.request('/api/library')).status).toBe(401);
        expect((await app.request('/api/library/0190b6a0-0000-7000-8000-000000000101')).status).toBe(401);
    });

    test('a product id must be a UUID', async () => {
        const res = await app.request('/api/library/hook', bearer(tokens.customer));
        expect(res.status).toBe(400);
    });
});

const url = process.env.TEST_DATABASE_URL;

// Runs against a real Postgres. Start it with `vp run db:up` (local) — CI provides one as a service.
describe.skipIf(!url)('the library (integration)', () => {
    const { db, pool } = createDatabase(url ?? '');
    const CREATOR_ID = 'user_library_creator';
    /** The users behind `tokens.customer` and `tokens.admin`. */
    const BUYER_ID = 'user_customer';
    const OTHER_ID = 'user_admin';
    const app = buildApp({ library: createLibraryService(db, createFakeStorage()) });
    let categoryId: string;

    async function resetCatalogue() {
        await db.delete(entitlements);
        await db.delete(orders);
        await db.delete(products);
        await db.delete(categories).where(sql`${categories.parentId} IS NOT NULL`);
        await db.delete(categories);
    }

    /** A published product with a paid file, a 3D preview and a cover image. */
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
                digitalPriceCents: 450,
                license: 'standard_digital',
                ...overrides,
            })
            .returning();
        const [file] = await db
            .insert(productFiles)
            .values([
                {
                    productId: product!.id,
                    kind: 'download',
                    format: 'stl',
                    filename: `${slug}.stl`,
                    storageKey: `products/${product!.id}/files/model.stl`,
                    sizeBytes: 1000,
                },
                {
                    productId: product!.id,
                    kind: 'preview',
                    format: 'glb',
                    filename: 'preview.glb',
                    storageKey: `products/${product!.id}/files/preview.glb`,
                    sizeBytes: 500,
                },
            ])
            .returning();
        await db.insert(productImages).values({
            productId: product!.id,
            storageKey: `products/${product!.id}/images/cover.webp`,
            alt: `${product!.title} on a desk`,
            width: 800,
            height: 600,
            sizeBytes: 1234,
        });
        return { ...product!, file: file! };
    }

    async function paidOrder(userId: string) {
        const [order] = await db
            .insert(orders)
            .values({
                userId,
                email: 'buyer@example.com',
                status: 'paid',
                paidAt: new Date('2026-11-16T12:00:00Z'),
                subtotalCents: 450,
                taxCents: 91,
                totalCents: 450,
                vatCountry: 'FI',
                vatRateBp: 2550,
            })
            .returning();
        return order!;
    }

    async function grant(userId: string, productId: string, grantedAt: Date, orderId: string | null = null) {
        await db.insert(entitlements).values({ userId, productId, orderId, grantedAt });
    }

    async function library(token: string = tokens.customer) {
        const res = await app.request('/api/library', bearer(token));
        expect(res.status).toBe(200);
        expect(res.headers.get('cache-control')).toBe('no-store');
        return librarySchema.parse(await res.json()).items;
    }

    beforeAll(async () => {
        await runMigrations(db, fileURLToPath(new URL('../drizzle', import.meta.url)));
        await resetCatalogue();
        await db.delete(users).where(inArray(users.id, [CREATOR_ID, BUYER_ID, OTHER_ID]));
        await db.insert(users).values([
            { id: CREATOR_ID, email: 'creator@example.com', role: 'creator' },
            { id: BUYER_ID, email: 'buyer@example.com', role: 'customer' },
            { id: OTHER_ID, email: 'other@example.com', role: 'admin' },
        ]);
    });

    beforeEach(async () => {
        await resetCatalogue();
        const [category] = await db.insert(categories).values({ slug: 'hooks', name: 'Hooks' }).returning();
        categoryId = category!.id;
    });

    afterAll(async () => {
        await resetCatalogue();
        await db.delete(users).where(inArray(users.id, [CREATOR_ID, BUYER_ID, OTHER_ID]));
        await pool.end();
    });

    test('is empty for someone who owns nothing', async () => {
        await model();
        expect(await library()).toEqual([]);
    });

    test('lists what the user owns, newest first, with cover, order and downloadable files only', async () => {
        const hook = await model({ title: 'Hook' });
        const stand = await model({ title: 'Stand' });
        const order = await paidOrder(BUYER_ID);
        await grant(BUYER_ID, hook.id, new Date('2026-11-10T12:00:00Z'), order.id);
        await grant(BUYER_ID, stand.id, new Date('2026-11-12T12:00:00Z'));

        const items = await library();
        expect(items.map((item) => item.title)).toEqual(['Stand', 'Hook']);
        expect(items[1]).toEqual({
            productId: hook.id,
            slug: hook.slug,
            title: 'Hook',
            cover: {
                url: `https://assets.test/products/${hook.id}/images/cover.webp`,
                alt: 'Hook on a desk',
                width: 800,
                height: 600,
            },
            listed: true,
            orderId: order.id,
            acquiredAt: '2026-11-10T12:00:00.000Z',
            files: [{ id: hook.file.id, format: 'stl', filename: `${hook.slug}.stl`, sizeBytes: 1000 }],
        });
        expect(items[0]!.orderId).toBeNull();
    });

    test("keeps archived models, marked as unlisted, but not drafts or other people's models", async () => {
        const archived = await model({ status: 'archived' });
        const draft = await model({ status: 'draft', publishedAt: null });
        const theirs = await model();
        await grant(BUYER_ID, archived.id, new Date('2026-11-10T12:00:00Z'));
        await grant(BUYER_ID, draft.id, new Date('2026-11-11T12:00:00Z'));
        await grant(OTHER_ID, theirs.id, new Date('2026-11-12T12:00:00Z'));

        const items = await library();
        expect(items.map((item) => [item.productId, item.listed])).toEqual([[archived.id, false]]);
        expect((await library(tokens.admin)).map((item) => item.productId)).toEqual([theirs.id]);
    });

    test('says whether the user owns one model', async () => {
        const hook = await model();
        const other = await model();
        await grant(BUYER_ID, hook.id, new Date('2026-11-10T12:00:00Z'));

        const owned = await app.request(`/api/library/${hook.id}`, bearer(tokens.customer));
        expect(owned.status).toBe(200);
        expect(libraryItemSchema.parse(await owned.json())).toMatchObject({
            productId: hook.id,
            files: [{ id: hook.file.id }],
        });

        const notOwned = await app.request(`/api/library/${other.id}`, bearer(tokens.customer));
        expect(notOwned.status).toBe(404);
        const missing = await app.request('/api/library/0190b6a0-0000-7000-8000-000000000999', bearer(tokens.customer));
        expect(missing.status).toBe(404);
    });
});
