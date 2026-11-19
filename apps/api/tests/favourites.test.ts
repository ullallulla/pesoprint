import { fileURLToPath } from 'node:url';

import { favouriteListSchema, favouriteStatusSchema, MAX_FAVOURITES } from '@app/shared';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vite-plus/test';

import { createDatabase, runMigrations } from '../src/db/client.ts';
import { categories, favourites, productImages, products, users, type NewProduct } from '../src/db/schema.ts';
import { createFavouritesService } from '../src/services/favourites.ts';
import { bearer, buildApp, createFakeStorage, tokens } from './helpers.ts';

const PRODUCT_ID = '0190b6a0-0000-7000-8000-000000000101';

function send(app: ReturnType<typeof buildApp>, method: string, path: string, token: string = tokens.customer) {
    return app.request(path, { method, ...bearer(token) });
}

describe('favourites without a database', () => {
    const app = buildApp();

    test.each([
        ['GET', '/api/favourites'],
        ['GET', `/api/favourites/${PRODUCT_ID}`],
        ['PUT', `/api/favourites/${PRODUCT_ID}`],
        ['DELETE', `/api/favourites/${PRODUCT_ID}`],
    ])('%s %s needs a signed-in user', async (method, path) => {
        expect((await app.request(path, { method })).status).toBe(401);
    });

    test('a product id must be a UUID', async () => {
        expect((await send(app, 'PUT', '/api/favourites/hook')).status).toBe(400);
    });
});

const url = process.env.TEST_DATABASE_URL;

// Runs against a real Postgres. Start it with `vp run db:up` (local) — CI provides one as a service.
describe.skipIf(!url)('favourites (integration)', () => {
    const { db, pool } = createDatabase(url ?? '');
    /** The users behind `tokens.customer` and `tokens.admin`. */
    const USER_ID = 'user_customer';
    const OTHER_ID = 'user_admin';
    const CREATOR_ID = 'user_favourites_creator';
    const app = buildApp({ favourites: createFavouritesService(db, createFakeStorage()) });
    let categoryId: string;

    async function reset() {
        await db.delete(products);
        await db.delete(categories).where(sql`${categories.parentId} IS NOT NULL`);
        await db.delete(categories);
    }

    async function model(overrides: Partial<NewProduct> = {}) {
        const [product] = await db
            .insert(products)
            .values({
                slug: `model-${Math.random().toString(36).slice(2, 8)}`,
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
        return product!;
    }

    async function status(productId: string, token: string = tokens.customer) {
        const res = await send(app, 'GET', `/api/favourites/${productId}`, token);
        expect(res.status).toBe(200);
        expect(res.headers.get('cache-control')).toBe('no-store');
        return favouriteStatusSchema.parse(await res.json()).saved;
    }

    async function save(productId: string) {
        const res = await send(app, 'PUT', `/api/favourites/${productId}`);
        expect(res.status).toBe(200);
        expect(favouriteStatusSchema.parse(await res.json())).toEqual({ saved: true });
    }

    async function list(token: string = tokens.customer) {
        const res = await send(app, 'GET', '/api/favourites', token);
        expect(res.status).toBe(200);
        expect(res.headers.get('cache-control')).toBe('no-store');
        return favouriteListSchema.parse(await res.json()).items;
    }

    beforeAll(async () => {
        await runMigrations(db, fileURLToPath(new URL('../drizzle', import.meta.url)));
        await reset();
        await db.delete(users).where(inArray(users.id, [USER_ID, OTHER_ID, CREATOR_ID]));
        await db.insert(users).values([
            { id: USER_ID, email: 'buyer@example.com', role: 'customer' },
            { id: OTHER_ID, email: 'other@example.com', role: 'admin' },
            { id: CREATOR_ID, email: 'creator@example.com', role: 'creator' },
        ]);
    });

    beforeEach(async () => {
        await reset();
        const [category] = await db.insert(categories).values({ slug: 'hooks', name: 'Hooks' }).returning();
        categoryId = category!.id;
    });

    afterAll(async () => {
        await reset();
        await db.delete(users).where(inArray(users.id, [USER_ID, OTHER_ID, CREATOR_ID]));
        await pool.end();
    });

    test('saving, saving again and forgetting a model', async () => {
        const hook = await model();
        expect(await status(hook.id)).toBe(false);

        await save(hook.id);
        await save(hook.id);
        expect(await status(hook.id)).toBe(true);
        expect(await db.select().from(favourites)).toHaveLength(1);
        // Someone else's favourites are their own.
        expect(await status(hook.id, tokens.admin)).toBe(false);

        const res = await send(app, 'DELETE', `/api/favourites/${hook.id}`);
        expect(res.status).toBe(200);
        expect(favouriteStatusSchema.parse(await res.json())).toEqual({ saved: false });
        expect(await status(hook.id)).toBe(false);
        expect((await send(app, 'DELETE', `/api/favourites/${hook.id}`)).status).toBe(200);
    });

    test('lists saved models as cards, most recently saved first', async () => {
        const hook = await model({ title: 'Hook', slug: 'hook' });
        const stand = await model({ title: 'Stand', slug: 'stand' });
        await db.insert(productImages).values({
            productId: hook.id,
            storageKey: `products/${hook.id}/images/cover.webp`,
            alt: 'A hook',
            width: 800,
            height: 600,
            sizeBytes: 1234,
        });
        await db.insert(favourites).values([
            { userId: USER_ID, productId: hook.id, createdAt: new Date('2026-11-10T09:00:00Z') },
            { userId: USER_ID, productId: stand.id, createdAt: new Date('2026-11-12T09:00:00Z') },
            { userId: OTHER_ID, productId: hook.id },
        ]);

        const items = await list();
        expect(items.map((item) => item.product.title)).toEqual(['Stand', 'Hook']);
        expect(items[1]).toEqual({
            productId: hook.id,
            savedAt: '2026-11-10T09:00:00.000Z',
            product: {
                slug: 'hook',
                title: 'Hook',
                category: { slug: 'hooks', name: 'Hooks' },
                cover: {
                    url: `https://assets.test/products/${hook.id}/images/cover.webp`,
                    alt: 'A hook',
                    width: 800,
                    height: 600,
                },
                digitalPriceCents: 0,
                printBasePriceCents: null,
                downloadCount: 0,
                rating: null,
                publishedAt: '2026-11-01T00:00:00.000Z',
            },
        });
    });

    test("an archived model isn't listed, but stays saved for when it's back", async () => {
        const hook = await model();
        await save(hook.id);
        await db.update(products).set({ status: 'archived' }).where(eq(products.id, hook.id));
        expect(await list()).toEqual([]);
        expect(await status(hook.id)).toBe(true);

        await db.update(products).set({ status: 'published' }).where(eq(products.id, hook.id));
        expect(await list()).toHaveLength(1);
    });

    test("a model that isn't published can't be saved", async () => {
        const draft = await model({ status: 'draft', publishedAt: null });
        expect((await send(app, 'PUT', `/api/favourites/${draft.id}`)).status).toBe(404);
        expect((await send(app, 'PUT', `/api/favourites/${PRODUCT_ID}`)).status).toBe(404);
    });

    test(`stops at ${MAX_FAVOURITES} saved models`, async () => {
        const hook = await model();
        const rows = await db
            .insert(products)
            .values(
                Array.from({ length: MAX_FAVOURITES }, (_, index) => ({
                    slug: `filler-${index}`,
                    title: `Filler ${index}`,
                    creatorId: CREATOR_ID,
                })),
            )
            .returning({ id: products.id });
        await db.insert(favourites).values(rows.map((row) => ({ userId: USER_ID, productId: row.id })));

        const res = await send(app, 'PUT', `/api/favourites/${hook.id}`);
        expect(res.status).toBe(409);
        expect(await status(hook.id)).toBe(false);
    });

    test("an account that hasn't been synced from Clerk yet is asked to wait", async () => {
        const hook = await model();
        await db.delete(users).where(eq(users.id, USER_ID));
        try {
            const res = await send(app, 'PUT', `/api/favourites/${hook.id}`);
            expect(res.status).toBe(409);
        } finally {
            await db.insert(users).values({ id: USER_ID, email: 'buyer@example.com', role: 'customer' });
        }
    });
});
