import { fileURLToPath } from 'node:url';

import { apiErrorSchema, cartQuoteSchema, MAX_CART_ITEMS, MAX_PRINT_LINES, type CartItem } from '@app/shared';
import { inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vite-plus/test';

import { createDatabase, runMigrations } from '../src/db/client.ts';
import {
    categories,
    colours,
    entitlements,
    materialColours,
    materials,
    orders,
    productColourOptionColours,
    productColourOptions,
    productImages,
    productMaterials,
    products,
    users,
    type NewProduct,
} from '../src/db/schema.ts';
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
        ['an unknown item type', { items: [{ productId: UNKNOWN_ID, type: 'sticker' }] }],
        [
            'a print without a material',
            { items: [{ productId: UNKNOWN_ID, type: 'print', colourOptionId: null, quantity: 1 }] },
        ],
        [
            'a print without a colour option (null when the model has none)',
            { items: [{ productId: UNKNOWN_ID, type: 'print', materialId: UNKNOWN_ID, quantity: 1 }] },
        ],
        [
            'a print of 11 copies',
            {
                items: [
                    {
                        productId: UNKNOWN_ID,
                        type: 'print',
                        materialId: UNKNOWN_ID,
                        colourOptionId: null,
                        quantity: 11,
                    },
                ],
            },
        ],
        [
            `more than ${MAX_PRINT_LINES} different prints`,
            {
                items: Array.from({ length: MAX_PRINT_LINES + 1 }, () => ({
                    productId: UNKNOWN_ID,
                    type: 'print',
                    materialId: UNKNOWN_ID,
                    colourOptionId: null,
                    quantity: 1,
                })),
            },
        ],
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
        await db.delete(materials);
        await db.delete(colours);
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
            parcelSize: null,
            shippingCents: 0,
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
                materialId: null,
                colourOptionId: null,
                slug: 'stand',
                title: 'Stand',
                cover: null,
                license: 'commercial',
                print: null,
                unitPriceCents: 1290,
                quantity: 1,
            },
            {
                productId: hook.id,
                type: 'digital',
                materialId: null,
                colourOptionId: null,
                slug: 'hook',
                title: 'Hook',
                cover: {
                    url: `https://assets.test/products/${hook.id}/images/a.webp`,
                    alt: 'Hook',
                    width: 1200,
                    height: 900,
                },
                license: 'standard_digital',
                print: null,
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
            parcelSize: 'S',
        });
        const archived = await model({ title: 'Old hook', status: 'archived' });
        const draft = await model({ title: 'Secret hook', status: 'draft', publishedAt: null });
        const onSale = await model({ title: 'Hook' });

        const result = await quote(
            [free, printOnly, archived, draft, onSale].map((p) => digital(p.id)).concat(digital(UNKNOWN_ID)),
        );

        expect(result.lines.map((line) => line.title)).toEqual(['Hook']);
        const gone = (productId: string, title: string | null) => ({
            productId,
            type: 'digital',
            materialId: null,
            colourOptionId: null,
            title,
            option: null,
            reason: 'unavailable',
        });
        expect(result.removed).toEqual([
            gone(free.id, 'Free hook'),
            gone(printOnly.id, 'Print only'),
            gone(archived.id, 'Old hook'),
            gone(draft.id, null),
            gone(UNKNOWN_ID, null),
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
            {
                productId: owned.id,
                type: 'digital',
                materialId: null,
                colourOptionId: null,
                title: 'Owned hook',
                option: null,
                reason: 'owned',
            },
        ]);
        expect(signedIn.totalCents).toBe(300);

        const visitor = await quote(items);
        expect(visitor.lines).toHaveLength(2);
        expect(visitor.totalCents).toBe(750);
    });

    describe('prints', () => {
        /**
         * A model printed in PLA and PETG, shipping in `parcelSize`, with the colour options black, blue, and
         * black and orange. PLA comes in all three colours, blue out of stock; PETG only in black and orange,
         * and can't mix them.
         */
        async function printable(parcelSize: 'S' | 'M' | 'L' = 'S', overrides: Partial<NewProduct> = {}) {
            const tag = Math.random().toString(36).slice(2, 8);
            const [pla, petg] = await db
                .insert(materials)
                .values([{ name: `PLA ${tag}` }, { name: `PETG ${tag}`, multicolour: false }])
                .returning();
            const [black, blue, orange] = await db
                .insert(colours)
                .values([
                    { name: `Black ${tag}`, hex: '#000000' },
                    { name: `Ocean blue ${tag}`, hex: '#1f5fa8' },
                    { name: `Orange ${tag}`, hex: '#f26b1d' },
                ])
                .returning();
            await db.insert(materialColours).values([
                { materialId: pla!.id, colourId: black!.id },
                { materialId: pla!.id, colourId: blue!.id, inStock: false },
                { materialId: pla!.id, colourId: orange!.id },
                { materialId: petg!.id, colourId: black!.id },
                { materialId: petg!.id, colourId: orange!.id },
            ]);
            const product = await model({
                title: 'Vase',
                digitalPriceCents: null,
                license: null,
                printBasePriceCents: 1290,
                parcelSize,
                ...overrides,
            });
            await db.insert(productMaterials).values([
                { productId: product.id, materialId: pla!.id, priceCents: 1290 },
                { productId: product.id, materialId: petg!.id, priceCents: 1590 },
            ]);
            const option = async (position: number, ...colourIds: string[]) => {
                const [row] = await db
                    .insert(productColourOptions)
                    .values({ productId: product.id, position })
                    .returning();
                await db
                    .insert(productColourOptionColours)
                    .values(colourIds.map((colourId, index) => ({ optionId: row!.id, colourId, position: index })));
                return row!;
            };
            const inBlack = await option(0, black!.id);
            const inBlue = await option(1, blue!.id);
            const inBlackAndOrange = await option(2, black!.id, orange!.id);
            return {
                product,
                pla: pla!,
                petg: petg!,
                black: black!,
                blue: blue!,
                orange: orange!,
                inBlack,
                inBlue,
                inBlackAndOrange,
            };
        }

        const print = (
            productId: string,
            materialId: string,
            colourOptionId: string | null,
            quantity = 1,
        ): CartItem => ({
            productId,
            type: 'print',
            materialId,
            colourOptionId,
            quantity,
        });

        test("prices each print at the model's price in its material, times the copies, plus one parcel's shipping", async () => {
            const { product, pla, petg, black, orange, inBlack, inBlackAndOrange } = await printable('S');

            const result = await quote([
                print(product.id, pla.id, inBlack.id, 2),
                print(product.id, pla.id, inBlackAndOrange.id),
                print(product.id, petg.id, inBlack.id),
            ]);

            expect(
                result.lines.map(({ materialId, colourOptionId, print, unitPriceCents, quantity, license }) => ({
                    materialId,
                    colourOptionId,
                    print,
                    unitPriceCents,
                    quantity,
                    license,
                })),
            ).toEqual([
                {
                    materialId: pla.id,
                    colourOptionId: inBlack.id,
                    print: {
                        materialName: pla.name,
                        colourName: black.name,
                        colours: [{ name: black.name, hex: '#000000' }],
                    },
                    unitPriceCents: 1290,
                    quantity: 2,
                    license: null,
                },
                {
                    materialId: pla.id,
                    colourOptionId: inBlackAndOrange.id,
                    print: {
                        materialName: pla.name,
                        colourName: `${black.name} / ${orange.name}`,
                        colours: [
                            { name: black.name, hex: '#000000' },
                            { name: orange.name, hex: '#f26b1d' },
                        ],
                    },
                    unitPriceCents: 1290,
                    quantity: 1,
                    license: null,
                },
                {
                    materialId: petg.id,
                    colourOptionId: inBlack.id,
                    print: expect.objectContaining({ materialName: petg.name, colourName: black.name }),
                    unitPriceCents: 1590,
                    quantity: 1,
                    license: null,
                },
            ]);
            // 2 × 12.90 + 12.90 + 15.90 = 54.60, and a small parcel: 2.90.
            expect(result).toMatchObject({
                subtotalCents: 5460,
                parcelSize: 'S',
                shippingCents: 290,
                totalCents: 5750,
            });
        });

        test('the same print in the same material and colour is one line, its copies added up (at most 10)', async () => {
            const { product, pla, petg, inBlack } = await printable();
            const result = await quote([
                print(product.id, pla.id, inBlack.id, 6),
                print(product.id, pla.id, inBlack.id, 7),
                print(product.id, petg.id, inBlack.id, 1),
            ]);
            expect(result.lines.map((line) => line.quantity)).toEqual([10, 1]);
        });

        test('a model without colour options is ordered by material alone, printed in the colours shown', async () => {
            const { product, pla, inBlack } = await printable();
            await db.delete(productColourOptions).where(inArray(productColourOptions.productId, [product.id]));

            const result = await quote([print(product.id, pla.id, null), print(product.id, pla.id, inBlack.id)]);

            expect(result.lines.map((line) => [line.colourOptionId, line.print])).toEqual([
                [null, { materialName: pla.name, colourName: null, colours: [] }],
            ]);
            // Its colour options are gone, so a cart that still holds one is told so.
            expect(result.removed.map(({ reason, option }) => [reason, option])).toEqual([
                ['option_unavailable', pla.name],
            ]);
        });

        test('the order ships in the largest parcel, and files ship nothing', async () => {
            const small = await printable('S');
            const large = await printable('L');
            const file = await model({ title: 'Hook' });

            expect((await quote([digital(file.id)])).shippingCents).toBe(0);
            const mixed = await quote([
                digital(file.id),
                print(small.product.id, small.pla.id, small.inBlack.id),
                print(large.product.id, large.pla.id, large.inBlack.id),
            ]);
            expect(mixed).toMatchObject({ parcelSize: 'L', shippingCents: 990 });
            // 4.50 + 12.90 + 12.90 + 9.90.
            expect(mixed.totalCents).toBe(4020);
        });

        test("takes out prints the material can't make, or that are out of stock or not offered", async () => {
            const { product, pla, petg, black, blue, orange, inBlack, inBlue, inBlackAndOrange } = await printable();
            const other = await printable('M');

            const result = await quote([
                // PLA is out of blue.
                print(product.id, pla.id, inBlue.id),
                // PETG doesn't come in blue, and can't mix colours.
                print(product.id, petg.id, inBlue.id),
                print(product.id, petg.id, inBlackAndOrange.id),
                // Another model's material and colour option: this model isn't offered in them.
                print(product.id, other.pla.id, inBlack.id),
                print(product.id, pla.id, other.inBlack.id),
                // The model has colour options, so one must be chosen.
                print(product.id, pla.id, null),
                print(product.id, UNKNOWN_ID, UNKNOWN_ID),
            ]);

            expect(result.lines).toEqual([]);
            expect(result.removed.map(({ reason, option }) => [reason, option])).toEqual([
                ['option_unavailable', `${pla.name}, ${blue.name}`],
                ['option_unavailable', `${petg.name}, ${blue.name}`],
                ['option_unavailable', `${petg.name}, ${black.name} / ${orange.name}`],
                ['option_unavailable', `${other.pla.name}, ${black.name}`],
                ['option_unavailable', pla.name],
                ['option_unavailable', pla.name],
                ['option_unavailable', null],
            ]);
            expect(result.shippingCents).toBe(0);

            // A material switched off.
            await db
                .update(materials)
                .set({ active: false })
                .where(inArray(materials.id, [petg.id]));
            const off = await quote([print(product.id, petg.id, inBlack.id)]);
            expect(off.removed.map(({ reason, option }) => [reason, option])).toEqual([
                ['option_unavailable', `${petg.name}, ${black.name}`],
            ]);
        });

        test('a model no longer printed is taken out', async () => {
            // It still sells its file, so it stays published.
            const { product, pla, inBlack } = await printable('S', {
                digitalPriceCents: 450,
                license: 'standard_digital',
            });
            await db
                .update(products)
                .set({ printBasePriceCents: null })
                .where(inArray(products.id, [product.id]));
            const result = await quote([print(product.id, pla.id, inBlack.id)]);
            expect(result.removed.map((item) => item.reason)).toEqual(['unavailable']);
        });
    });
});
