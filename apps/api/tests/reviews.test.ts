import { fileURLToPath } from 'node:url';

import {
    adminReviewListSchema,
    adminReviewSchema,
    apiErrorSchema,
    catalogProductListSchema,
    catalogProductSchema,
    myReviewSchema,
    productReviewsSchema,
    REVIEW_BODY_MAX_LENGTH,
} from '@app/shared';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vite-plus/test';

import { createDatabase, runMigrations } from '../src/db/client.ts';
import {
    categories,
    downloadEvents,
    entitlements,
    materials,
    orderItems,
    orders,
    products,
    reviews,
    users,
    type NewOrder,
    type NewProduct,
} from '../src/db/schema.ts';
import { createAdminReviewsService } from '../src/services/admin-reviews.ts';
import { createCatalogService } from '../src/services/catalog.ts';
import { createReviewsService } from '../src/services/reviews.ts';
import { bearer, buildApp, createFakeStorage, tokens } from './helpers.ts';

const PRODUCT_ID = '0190b6a0-0000-7000-8000-000000000101';
const REVIEW_ID = '0190b6a0-0000-7000-8000-000000000501';

function send(
    app: ReturnType<typeof buildApp>,
    method: string,
    path: string,
    body?: unknown,
    token: string = tokens.customer,
) {
    return app.request(path, {
        method,
        headers: { 'content-type': 'application/json', ...bearer(token).headers },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

describe('reviews without a database', () => {
    const app = buildApp();

    test.each([
        ['GET', `/api/me/reviews/${PRODUCT_ID}`],
        ['PUT', `/api/me/reviews/${PRODUCT_ID}`],
        ['DELETE', `/api/me/reviews/${PRODUCT_ID}`],
    ])('%s %s needs a signed-in user', async (method, path) => {
        const res = await app.request(path, {
            method,
            headers: { 'content-type': 'application/json' },
            body: method === 'PUT' ? JSON.stringify({ rating: 5 }) : undefined,
        });
        expect(res.status).toBe(401);
    });

    test.each([
        [{}],
        [{ rating: 0 }],
        [{ rating: 6 }],
        [{ rating: 4.5 }],
        [{ rating: '5' }],
        [{ rating: 5, body: 'x'.repeat(REVIEW_BODY_MAX_LENGTH + 1) }],
    ])('refuses the review %j', async (body) => {
        const res = await send(app, 'PUT', `/api/me/reviews/${PRODUCT_ID}`, body);
        expect(res.status).toBe(400);
    });

    test('a product id must be a UUID', async () => {
        expect((await send(app, 'GET', '/api/me/reviews/hook')).status).toBe(400);
    });

    test.each([
        ['GET', '/api/admin/reviews'],
        ['POST', `/api/admin/reviews/${REVIEW_ID}/visibility`],
    ])('%s %s is for admins only', async (method, path) => {
        const init = {
            method,
            headers: { 'content-type': 'application/json' },
            body: method === 'POST' ? JSON.stringify({ hidden: true }) : undefined,
        };
        expect((await app.request(path, init)).status).toBe(401);
        expect((await send(app, method, path, method === 'POST' ? { hidden: true } : undefined)).status).toBe(403);
    });

    test('refuses a visibility change without `hidden`', async () => {
        const res = await send(app, 'POST', `/api/admin/reviews/${REVIEW_ID}/visibility`, {}, tokens.admin);
        expect(res.status).toBe(400);
    });
});

const url = process.env.TEST_DATABASE_URL;

// Runs against a real Postgres. Start it with `vp run db:up` (local) — CI provides one as a service.
describe.skipIf(!url)('reviews (integration)', () => {
    const { db, pool } = createDatabase(url ?? '');
    /** The users behind `tokens.customer` and `tokens.admin`. */
    const BUYER_ID = 'user_customer';
    const ADMIN_ID = 'user_admin';
    const CREATOR_ID = 'user_reviews_creator';
    const OTHER_ID = 'user_reviews_other';
    let now = new Date('2026-11-19T09:00:00Z');
    const storage = createFakeStorage();
    const app = buildApp({
        reviews: createReviewsService(db, { now: () => now }),
        adminReviews: createAdminReviewsService(db, { now: () => now }),
        catalog: createCatalogService(db, storage),
    });
    let categoryId: string;

    async function reset() {
        await db.delete(reviews);
        await db.delete(entitlements);
        await db.delete(orders);
        await db.delete(products);
        await db.delete(materials);
        await db.delete(categories).where(sql`${categories.parentId} IS NOT NULL`);
        await db.delete(categories);
    }

    /** A published model with a paid file. */
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
                digitalPriceCents: 450,
                license: 'standard_digital',
                ...overrides,
            })
            .returning();
        return product!;
    }

    async function printOrder(productId: string, overrides: Partial<NewOrder>) {
        const [material] = await db
            .insert(materials)
            .values({ name: `PLA ${Math.random()}` })
            .returning();
        const [order] = await db
            .insert(orders)
            .values({
                userId: BUYER_ID,
                email: 'buyer@example.com',
                status: 'paid',
                subtotalCents: 1290,
                shippingCents: 490,
                parcelSize: 'M',
                taxCents: 363,
                totalCents: 1780,
                vatCountry: 'FI',
                vatRateBp: 2550,
                paidAt: new Date('2026-11-10T10:00:00Z'),
                ...overrides,
            })
            .returning();
        await db.insert(orderItems).values({
            orderId: order!.id,
            productId,
            type: 'print',
            unitPriceCents: 1290,
            titleSnapshot: 'Hook',
            materialId: material!.id,
            printSnapshot: { materialName: 'PLA', colourName: null, colours: [] },
        });
        return order!;
    }

    const shipped = {
        carrier: 'Posti',
        trackingNumber: 'JJFI123',
        shippedAt: new Date('2026-11-11T10:00:00Z'),
    } as const;

    async function grant(userId: string, productId: string) {
        await db.insert(entitlements).values({ userId, productId });
    }

    async function totals(productId: string) {
        const [row] = await db
            .select({ sum: products.ratingSum, count: products.ratingCount })
            .from(products)
            .where(eq(products.id, productId));
        return row!;
    }

    async function mine(productId: string, token: string = tokens.customer) {
        const res = await send(app, 'GET', `/api/me/reviews/${productId}`, undefined, token);
        expect(res.status).toBe(200);
        expect(res.headers.get('cache-control')).toBe('no-store');
        return myReviewSchema.parse(await res.json());
    }

    function write(productId: string, body: unknown, token: string = tokens.customer) {
        return send(app, 'PUT', `/api/me/reviews/${productId}`, body, token);
    }

    async function written(productId: string, body: unknown, token: string = tokens.customer) {
        const res = await write(productId, body, token);
        expect(res.status).toBe(200);
        return myReviewSchema.parse(await res.json());
    }

    async function publicReviews(slug: string, query = '') {
        const res = await app.request(`/api/catalog/products/${slug}/reviews${query}`);
        expect(res.status).toBe(200);
        return productReviewsSchema.parse(await res.json());
    }

    async function adminList(query = '') {
        const res = await app.request(`/api/admin/reviews${query}`, bearer(tokens.admin));
        expect(res.status).toBe(200);
        return adminReviewListSchema.parse(await res.json());
    }

    async function setHidden(reviewId: string, hidden: boolean) {
        const res = await send(app, 'POST', `/api/admin/reviews/${reviewId}/visibility`, { hidden }, tokens.admin);
        expect(res.status).toBe(200);
        return adminReviewSchema.parse(await res.json());
    }

    beforeAll(async () => {
        await runMigrations(db, fileURLToPath(new URL('../drizzle', import.meta.url)));
        await reset();
        await db.delete(users).where(inArray(users.id, [BUYER_ID, ADMIN_ID, CREATOR_ID, OTHER_ID]));
        await db.insert(users).values([
            { id: BUYER_ID, email: 'buyer@example.com', displayName: 'Aino Korhonen', role: 'customer' },
            { id: ADMIN_ID, email: 'admin@example.com', displayName: 'Shop Admin', role: 'admin' },
            { id: CREATOR_ID, email: 'creator@example.com', role: 'creator' },
            { id: OTHER_ID, email: 'other@example.com', displayName: 'Ville', role: 'customer' },
        ]);
    });

    beforeEach(async () => {
        await reset();
        now = new Date('2026-11-19T09:00:00Z');
        const [category] = await db.insert(categories).values({ slug: 'hooks', name: 'Hooks' }).returning();
        categoryId = category!.id;
    });

    afterAll(async () => {
        await reset();
        await db.delete(users).where(inArray(users.id, [BUYER_ID, ADMIN_ID, CREATOR_ID, OTHER_ID]));
        await pool.end();
    });

    describe('who may review', () => {
        test("someone who didn't buy the model is refused by the server, and nothing is stored", async () => {
            const hook = await model();
            expect(await mine(hook.id)).toEqual({ eligible: false, review: null });

            const res = await write(hook.id, { rating: 5, body: 'Great!' });
            expect(res.status).toBe(403);
            expect(apiErrorSchema.parse(await res.json()).error.code).toBe('forbidden');
            expect(await db.select().from(reviews)).toEqual([]);
            expect(await totals(hook.id)).toEqual({ sum: 0, count: 0 });
        });

        test('a buyer of the file may review it', async () => {
            const hook = await model();
            await grant(BUYER_ID, hook.id);
            expect((await mine(hook.id)).eligible).toBe(true);

            const saved = await written(hook.id, { rating: 4, body: '  Sturdy and easy to print.  ' });
            expect(saved).toEqual({
                eligible: true,
                review: {
                    id: expect.any(String),
                    rating: 4,
                    body: 'Sturdy and easy to print.',
                    author: 'Aino K.',
                    createdAt: '2026-11-19T09:00:00.000Z',
                    editedAt: null,
                    hidden: false,
                },
            });
        });

        test('a print buyer may review once the parcel is delivered, not before', async () => {
            const hook = await model({
                digitalPriceCents: null,
                license: null,
                printBasePriceCents: 1290,
                parcelSize: 'M',
            });
            const order = await printOrder(hook.id, { status: 'shipped', ...shipped });
            expect((await mine(hook.id)).eligible).toBe(false);
            expect((await write(hook.id, { rating: 5 })).status).toBe(403);

            await db
                .update(orders)
                .set({ status: 'delivered', deliveredAt: new Date('2026-11-13T10:00:00Z') })
                .where(eq(orders.id, order.id));
            expect((await mine(hook.id)).eligible).toBe(true);
            expect((await write(hook.id, { rating: 5 })).status).toBe(200);
        });

        test("someone else's delivered print doesn't count", async () => {
            const hook = await model({
                digitalPriceCents: null,
                license: null,
                printBasePriceCents: 1290,
                parcelSize: 'M',
            });
            await printOrder(hook.id, {
                userId: OTHER_ID,
                status: 'delivered',
                ...shipped,
                deliveredAt: new Date('2026-11-13T10:00:00Z'),
            });
            expect((await mine(hook.id)).eligible).toBe(false);
        });

        test('a free model may be reviewed by someone who downloaded it while signed in', async () => {
            const free = await model({ digitalPriceCents: 0, license: 'cc_by' });
            expect((await mine(free.id)).eligible).toBe(false);

            // Downloaded without signing in: nothing ties it to the account.
            await db.insert(downloadEvents).values({ productId: free.id, userId: null });
            expect((await mine(free.id)).eligible).toBe(false);

            await db.insert(downloadEvents).values({ productId: free.id, userId: BUYER_ID });
            expect((await mine(free.id)).eligible).toBe(true);
        });

        test("a download of a paid model (e.g. by staff) isn't a purchase", async () => {
            const paid = await model();
            await db.insert(downloadEvents).values({ productId: paid.id, userId: ADMIN_ID });
            expect((await mine(paid.id, tokens.admin)).eligible).toBe(false);
            expect((await write(paid.id, { rating: 5 }, tokens.admin)).status).toBe(403);
        });

        test('the creator may not review their own model', async () => {
            const own = await model({ creatorId: BUYER_ID });
            await grant(BUYER_ID, own.id);
            expect((await mine(own.id)).eligible).toBe(false);
            expect((await write(own.id, { rating: 5 })).status).toBe(403);
        });

        test("a model that isn't published can't be reviewed", async () => {
            const draft = await model({ status: 'draft', publishedAt: null });
            await grant(BUYER_ID, draft.id);
            expect((await send(app, 'GET', `/api/me/reviews/${draft.id}`)).status).toBe(404);
            expect((await write(draft.id, { rating: 5 })).status).toBe(404);
        });
    });

    describe('writing, changing and deleting', () => {
        test('one review per person: writing again changes it, and the rating follows', async () => {
            const hook = await model();
            await grant(BUYER_ID, hook.id);
            await written(hook.id, { rating: 2, body: 'Snapped.' });
            expect(await totals(hook.id)).toEqual({ sum: 2, count: 1 });

            now = new Date('2026-11-20T09:00:00Z');
            const changed = await written(hook.id, { rating: 5, body: 'Reprinted in PETG, holds fine.' });
            expect(changed.review).toMatchObject({
                rating: 5,
                body: 'Reprinted in PETG, holds fine.',
                createdAt: '2026-11-19T09:00:00.000Z',
                editedAt: '2026-11-20T09:00:00.000Z',
            });
            expect(await db.select().from(reviews)).toHaveLength(1);
            expect(await totals(hook.id)).toEqual({ sum: 5, count: 1 });

            // The same review sent again isn't an edit.
            now = new Date('2026-11-21T09:00:00Z');
            const again = await written(hook.id, { rating: 5, body: 'Reprinted in PETG, holds fine.' });
            expect(again.review?.editedAt).toBe('2026-11-20T09:00:00.000Z');
        });

        test('a rating needs no text', async () => {
            const hook = await model();
            await grant(BUYER_ID, hook.id);
            expect((await written(hook.id, { rating: 3 })).review?.body).toBe('');
        });

        test('deleting a review takes it out of the rating; deleting none is fine', async () => {
            const hook = await model();
            await grant(BUYER_ID, hook.id);
            await written(hook.id, { rating: 4 });

            const res = await send(app, 'DELETE', `/api/me/reviews/${hook.id}`);
            expect(res.status).toBe(204);
            expect(await mine(hook.id)).toEqual({ eligible: true, review: null });
            expect(await totals(hook.id)).toEqual({ sum: 0, count: 0 });
            expect((await send(app, 'DELETE', `/api/me/reviews/${hook.id}`)).status).toBe(204);
        });

        test("a deleted account's reviews go, and so do their ratings", async () => {
            const hook = await model();
            await db.insert(reviews).values([
                { productId: hook.id, userId: OTHER_ID, rating: 1 },
                { productId: hook.id, userId: BUYER_ID, rating: 5 },
            ]);
            expect(await totals(hook.id)).toEqual({ sum: 6, count: 2 });

            await db.delete(users).where(eq(users.id, OTHER_ID));
            expect(await totals(hook.id)).toEqual({ sum: 5, count: 1 });
            await db.insert(users).values({ id: OTHER_ID, email: 'other@example.com', displayName: 'Ville' });
        });
    });

    describe('on the model page', () => {
        test('lists visible reviews newest first, by first name and initial, a page at a time', async () => {
            const hook = await model();
            await db.insert(reviews).values([
                {
                    productId: hook.id,
                    userId: OTHER_ID,
                    rating: 3,
                    body: 'Fine.',
                    createdAt: new Date('2026-11-15T09:00:00Z'),
                },
                {
                    productId: hook.id,
                    userId: BUYER_ID,
                    rating: 5,
                    body: 'Love it.',
                    createdAt: new Date('2026-11-16T09:00:00Z'),
                },
                {
                    productId: hook.id,
                    userId: ADMIN_ID,
                    rating: 1,
                    body: 'Spam',
                    hiddenAt: new Date('2026-11-17T09:00:00Z'),
                },
            ]);

            const first = await publicReviews(hook.slug, '?pageSize=1');
            expect(first.total).toBe(2);
            expect(first.reviews).toEqual([
                {
                    id: expect.any(String),
                    rating: 5,
                    body: 'Love it.',
                    author: 'Aino K.',
                    createdAt: '2026-11-16T09:00:00.000Z',
                    editedAt: null,
                },
            ]);
            const second = await publicReviews(hook.slug, '?pageSize=1&page=2');
            expect(second.reviews.map((review) => [review.author, review.body])).toEqual([['Ville', 'Fine.']]);
            // The response never says who wrote it beyond the name shown.
            expect(JSON.stringify(first)).not.toContain('example.com');
        });

        test('the product and its card show the average of the visible ratings', async () => {
            const hook = await model({ slug: 'hook' });
            await db.insert(reviews).values([
                { productId: hook.id, userId: OTHER_ID, rating: 4 },
                { productId: hook.id, userId: BUYER_ID, rating: 5 },
                { productId: hook.id, userId: ADMIN_ID, rating: 5 },
            ]);

            const product = catalogProductSchema.parse(await (await app.request('/api/catalog/products/hook')).json());
            expect(product.rating).toEqual({ average: 4.7, count: 3 });
            const list = catalogProductListSchema.parse(await (await app.request('/api/catalog/products')).json());
            expect(list.products[0]?.rating).toEqual({ average: 4.7, count: 3 });
        });

        test("an unknown or unpublished model's reviews are a 404", async () => {
            await model({ slug: 'draft', status: 'draft', publishedAt: null });
            expect((await app.request('/api/catalog/products/draft/reviews')).status).toBe(404);
            expect((await app.request('/api/catalog/products/nope/reviews')).status).toBe(404);
        });
    });

    describe('hiding (admin)', () => {
        test("a hidden review leaves the page and the rating; its author still sees it, and editing doesn't unhide it", async () => {
            const hook = await model();
            await grant(BUYER_ID, hook.id);
            const { review } = await written(hook.id, { rating: 1, body: 'Rude words' });
            expect(await totals(hook.id)).toEqual({ sum: 1, count: 1 });

            const hidden = await setHidden(review!.id, true);
            expect(hidden).toMatchObject({
                hiddenAt: '2026-11-19T09:00:00.000Z',
                product: { id: hook.id, slug: hook.slug, title: 'Hook', listed: true },
                user: { id: BUYER_ID, email: 'buyer@example.com', displayName: 'Aino Korhonen' },
            });
            expect(await totals(hook.id)).toEqual({ sum: 0, count: 0 });
            expect((await publicReviews(hook.slug)).reviews).toEqual([]);
            expect((await mine(hook.id)).review?.hidden).toBe(true);

            // Hiding it again keeps when it was first hidden.
            now = new Date('2026-11-20T09:00:00Z');
            expect((await setHidden(review!.id, true)).hiddenAt).toBe('2026-11-19T09:00:00.000Z');

            await written(hook.id, { rating: 2, body: 'Polite words' });
            expect((await mine(hook.id)).review).toMatchObject({ rating: 2, hidden: true });
            expect(await totals(hook.id)).toEqual({ sum: 0, count: 0 });

            const shown = await setHidden(review!.id, false);
            expect(shown.hiddenAt).toBeNull();
            expect(await totals(hook.id)).toEqual({ sum: 2, count: 1 });
            expect((await publicReviews(hook.slug)).total).toBe(1);
        });

        test('lists every review newest first, filtered by visibility and text', async () => {
            const hook = await model({ title: 'Wall hook' });
            const stand = await model({ title: 'Phone stand' });
            await db.insert(reviews).values([
                {
                    productId: hook.id,
                    userId: BUYER_ID,
                    rating: 5,
                    body: 'Perfect',
                    createdAt: new Date('2026-11-10T09:00:00Z'),
                },
                {
                    productId: stand.id,
                    userId: OTHER_ID,
                    rating: 1,
                    body: 'Buy my stuff at spam.example',
                    createdAt: new Date('2026-11-12T09:00:00Z'),
                    hiddenAt: new Date('2026-11-13T09:00:00Z'),
                },
            ]);

            const all = await adminList();
            expect(all.total).toBe(2);
            expect(all.reviews.map((review) => review.body)).toEqual(['Buy my stuff at spam.example', 'Perfect']);
            expect((await adminList('?visibility=hidden')).reviews.map((r) => r.product.title)).toEqual([
                'Phone stand',
            ]);
            expect((await adminList('?visibility=visible')).reviews.map((r) => r.product.title)).toEqual(['Wall hook']);
            expect((await adminList('?q=wall')).total).toBe(1);
            expect((await adminList('?q=other%40example')).reviews.map((r) => r.user.id)).toEqual([OTHER_ID]);
            expect((await adminList('?q=korhonen')).reviews.map((r) => r.user.id)).toEqual([BUYER_ID]);
            expect((await adminList('?q=100%25')).total).toBe(0);
        });

        test('an unknown review is a 404', async () => {
            const res = await send(
                app,
                'POST',
                `/api/admin/reviews/${REVIEW_ID}/visibility`,
                { hidden: true },
                tokens.admin,
            );
            expect(res.status).toBe(404);
        });
    });
});
