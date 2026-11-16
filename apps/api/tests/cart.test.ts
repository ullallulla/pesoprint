import { fileURLToPath } from 'node:url';

import { apiErrorSchema, cartQuoteSchema, MAX_CART_ITEMS, type CartItem } from '@app/shared';
import { inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vite-plus/test';

import { createDatabase, runMigrations } from '../src/db/client.ts';
import { categories, entitlements, orders, productImages, products, users, type NewProduct } from '../src/db/schema.ts';
import { createCartService } from '../src/services/cart.ts';
import { bearer, buildApp, createFakeStorage, tokens } from './helpers.ts';

const UNKNOWN_ID = '0190a6d2-3b7e-7000-8000-000000000000';

describe('cart quote validation', () => {
    const app = buildApp();
    const quote = (body: unknown) =>
        app.request('/api/cart/quote', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });

    test.each([
        ['no items array', {}],
        ['a product id that is not a UUID', { items: [{ productId: 'hook', type: 'digital' }] }],
        ['an unknown item type', { items: [{ productId: UNKNOWN_ID, type: 'print' }] }],
        [
            `more than ${MAX_CART_ITEMS} items`,
            { items: Array.from({ length: MAX_CART_ITEMS + 1 }, () => ({ productId: UNKNOWN_ID, type: 'digital' })) },
        ],
    ])('rejects %s', async (_, body) => {
        const res = await quote(body);
        expect(res.status).toBe(400);
        expect(apiErrorSchema.parse(await res.json()).error.code).toBe('validation_failed');
    });

    test('rejects an invalid session instead of pricing the cart as a visitor', async () => {
        const res = await app.request('/api/cart/quote', {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: 'Bearer expired' },
            body: JSON.stringify({ items: [] }),
        });
        expect(res.status).toBe(401);
    });
});

const url = process.env.TEST_DATABASE_URL;

// Runs against a real Postgres. Start it with `vp run db:up` (local) — CI provides one as a service.
describe.skipIf(!url)('cart quote (integration)', () => {
    const { db, pool } = createDatabase(url ?? '');
    const CREATOR_ID = 'user_cart_creator';
    /** The user behind `tokens.customer`. */
    const BUYER_ID = 'user_customer';
    const storage = createFakeStorage();
    const app = buildApp({ cart: createCartService(db, storage) });
    let categoryId: string;

    async function resetCatalogue() {
        await db.delete(entitlements);
        await db.delete(orders);
        await db.delete(products);
        await db.delete(categories).where(sql`${categories.parentId} IS NOT NULL`);
        await db.delete(categories);
    }

    /** A published product with a paid file by default. */
    async function model(overrides: Partial<NewProduct> = {}) {
        const [product] = await db
            .insert(products)
            .values({
                slug: overrides.slug ?? `model-${Math.random().toString(36).slice(2, 8)}`,
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

    const digital = (productId: string): CartItem => ({ productId, type: 'digital' });

    async function quote(items: CartItem[], headers: Record<string, string> = {}) {
        const res = await app.request('/api/cart/quote', {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...headers },
            body: JSON.stringify({ items }),
        });
        expect(res.status).toBe(200);
        expect(res.headers.get('cache-control')).toBe('no-store');
        return cartQuoteSchema.parse(await res.json());
    }

    beforeAll(async () => {
        await runMigrations(db, fileURLToPath(new URL('../drizzle', import.meta.url)));
        await resetCatalogue();
        await db.delete(users).where(inArray(users.id, [CREATOR_ID, BUYER_ID]));
        await db.insert(users).values([
            { id: CREATOR_ID, email: 'creator@example.com', role: 'creator' },
            { id: BUYER_ID, email: 'buyer@example.com', role: 'customer' },
        ]);
    });

    beforeEach(async () => {
        await resetCatalogue();
        const [category] = await db.insert(categories).values({ slug: 'hooks', name: 'Hooks' }).returning();
        categoryId = category!.id;
    });

    afterAll(async () => {
        await resetCatalogue();
        await db.delete(users).where(inArray(users.id, [CREATOR_ID, BUYER_ID]));
        await pool.end();
    });

    test('an empty cart costs nothing', async () => {
        expect(await quote([])).toEqual({
            lines: [],
            removed: [],
            currency: 'EUR',
            subtotalCents: 0,
            totalCents: 0,
            taxCents: 0,
            vatCountry: 'FI',
            vatRateBp: 2550,
        });
    });

    test('prices the files from the catalogue, with the cover and the VAT the total contains', async () => {
        const hook = await model({ slug: 'hook', title: 'Hook', digitalPriceCents: 450 });
        const stand = await model({ slug: 'stand', title: 'Stand', digitalPriceCents: 1290, license: 'commercial' });
        await db.insert(productImages).values([
            {
                productId: hook.id,
                storageKey: `products/${hook.id}/images/b.webp`,
                alt: 'Hook from the side',
                width: 800,
                height: 600,
                sizeBytes: 100,
                position: 1,
            },
            {
                productId: hook.id,
                storageKey: `products/${hook.id}/images/a.webp`,
                alt: 'Hook',
                width: 1200,
                height: 900,
                sizeBytes: 100,
                position: 0,
            },
        ]);

        const result = await quote([digital(stand.id), digital(hook.id)]);

        expect(result.lines).toEqual([
            {
                productId: stand.id,
                type: 'digital',
                slug: 'stand',
                title: 'Stand',
                cover: null,
                license: 'commercial',
                unitPriceCents: 1290,
                quantity: 1,
            },
            {
                productId: hook.id,
                type: 'digital',
                slug: 'hook',
                title: 'Hook',
                cover: {
                    url: `https://assets.test/products/${hook.id}/images/a.webp`,
                    alt: 'Hook',
                    width: 1200,
                    height: 900,
                },
                license: 'standard_digital',
                unitPriceCents: 450,
                quantity: 1,
            },
        ]);
        expect(result.removed).toEqual([]);
        // €17.40 incl. 25.5 % VAT: net 1740 / 1.255 = 1386.45 → €13.86, so the VAT is €3.54.
        expect(result).toMatchObject({ subtotalCents: 1740, totalCents: 1740, taxCents: 354 });
    });

    test('the same file twice is bought once', async () => {
        const hook = await model();
        const result = await quote([digital(hook.id), digital(hook.id)]);
        expect(result.lines).toHaveLength(1);
        expect(result.totalCents).toBe(450);
    });

    test('a price change shows up at once: the cart never keeps the old price', async () => {
        const hook = await model({ digitalPriceCents: 450 });
        expect((await quote([digital(hook.id)])).totalCents).toBe(450);
        await db
            .update(products)
            .set({ digitalPriceCents: 500 })
            .where(inArray(products.id, [hook.id]));
        expect((await quote([digital(hook.id)])).totalCents).toBe(500);
    });

    test("removes what isn't for sale, without giving away a draft's title", async () => {
        const free = await model({ title: 'Free hook', digitalPriceCents: 0, license: 'cc_by' });
        const printOnly = await model({
            title: 'Print only',
            digitalPriceCents: null,
            license: null,
            printBasePriceCents: 1290,
        });
        const archived = await model({ title: 'Old hook', status: 'archived' });
        const draft = await model({ title: 'Secret hook', status: 'draft', publishedAt: null });
        const onSale = await model({ title: 'Hook' });

        const result = await quote(
            [free, printOnly, archived, draft, onSale].map((p) => digital(p.id)).concat(digital(UNKNOWN_ID)),
        );

        expect(result.lines.map((line) => line.title)).toEqual(['Hook']);
        expect(result.removed).toEqual([
            { productId: free.id, type: 'digital', title: 'Free hook', reason: 'unavailable' },
            { productId: printOnly.id, type: 'digital', title: 'Print only', reason: 'unavailable' },
            { productId: archived.id, type: 'digital', title: 'Old hook', reason: 'unavailable' },
            { productId: draft.id, type: 'digital', title: null, reason: 'unavailable' },
            { productId: UNKNOWN_ID, type: 'digital', title: null, reason: 'unavailable' },
        ]);
        expect(result.totalCents).toBe(450);
    });

    test('a signed-in buyer is not charged again for a file they own; a visitor sees it as for sale', async () => {
        const owned = await model({ title: 'Owned hook' });
        const other = await model({ title: 'Other hook', digitalPriceCents: 300 });
        await db.insert(entitlements).values({ userId: BUYER_ID, productId: owned.id });
        const items = [digital(owned.id), digital(other.id)];

        const signedIn = await quote(items, bearer(tokens.customer).headers);
        expect(signedIn.lines.map((line) => line.title)).toEqual(['Other hook']);
        expect(signedIn.removed).toEqual([
            { productId: owned.id, type: 'digital', title: 'Owned hook', reason: 'owned' },
        ]);
        expect(signedIn.totalCents).toBe(300);

        const visitor = await quote(items);
        expect(visitor.lines).toHaveLength(2);
        expect(visitor.totalCents).toBe(750);
    });
});
