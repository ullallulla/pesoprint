import { fileURLToPath } from 'node:url';

import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vite-plus/test';

import { createDatabase, runMigrations } from '../src/db/client.ts';
import {
    categories,
    entitlements,
    materials,
    orderItems,
    orders,
    products,
    users,
    type NewOrder,
} from '../src/db/schema.ts';

const url = process.env.TEST_DATABASE_URL;

// Runs against a real Postgres. Start it with `vp run db:up` (local) — CI provides one as a service.
describe.skipIf(!url)('orders schema (integration)', () => {
    const { db, pool } = createDatabase(url ?? '');
    const BUYER_ID = 'user_orders_buyer';
    const CREATOR_ID = 'user_orders_creator';
    let productId: string;

    /** A €4.50 file order, VAT 25.5 % included. */
    const order = (overrides: Partial<NewOrder> = {}): NewOrder => ({
        userId: BUYER_ID,
        email: 'buyer@example.com',
        subtotalCents: 450,
        taxCents: 91,
        totalCents: 450,
        vatCountry: 'FI',
        vatRateBp: 2550,
        ...overrides,
    });

    /** The name of the database rule an insert or update broke. */
    async function violated(write: Promise<unknown>): Promise<string | undefined> {
        const error = await write.then(
            () => undefined,
            (e: unknown) => e,
        );
        const cause = (error as { cause?: { constraint?: string } } | undefined)?.cause;
        return cause?.constraint;
    }

    async function reset() {
        await db.delete(entitlements);
        await db.delete(orders);
        await db.delete(products);
        await db.delete(materials);
        await db.delete(categories).where(sql`${categories.parentId} IS NOT NULL`);
        await db.delete(categories);
    }

    beforeAll(async () => {
        await runMigrations(db, fileURLToPath(new URL('../drizzle', import.meta.url)));
        await reset();
        await db.delete(users).where(inArray(users.id, [BUYER_ID, CREATOR_ID]));
        await db.insert(users).values([
            { id: BUYER_ID, email: 'buyer@example.com', role: 'customer' },
            { id: CREATOR_ID, email: 'creator@example.com', role: 'creator' },
        ]);
    });

    beforeEach(async () => {
        await reset();
        const [product] = await db
            .insert(products)
            .values({ slug: 'hook', title: 'Hook', creatorId: CREATOR_ID, digitalPriceCents: 450 })
            .returning();
        productId = product!.id;
    });

    afterAll(async () => {
        await reset();
        await db.delete(users).where(inArray(users.id, [BUYER_ID, CREATOR_ID]));
        await pool.end();
    });

    test('a new order is pending, in euros', async () => {
        const [row] = await db.insert(orders).values(order()).returning();
        expect(row).toMatchObject({ status: 'pending', currency: 'EUR', paidAt: null, stripeCheckoutSessionId: null });
    });

    test.each([
        ['orders_total_is_subtotal_plus_shipping', { totalCents: 500 }],
        ['orders_total_is_subtotal_plus_shipping', { shippingCents: 290, parcelSize: 'S' as const }],
        ['orders_shipping_has_parcel', { shippingCents: 290, totalCents: 740 }],
        ['orders_tax_within_total', { taxCents: 451 }],
        ['orders_amounts_non_negative', { subtotalCents: -1, totalCents: -1 }],
        ['orders_currency_eur', { currency: 'USD' }],
        ['orders_vat_country_format', { vatCountry: 'fi' }],
        ['orders_vat_rate_range', { vatRateBp: 10001 }],
        ['orders_paid_has_paid_at', { status: 'paid' as const }],
    ])('refuses an order that breaks %s', async (constraint, overrides) => {
        expect(await violated(db.insert(orders).values(order(overrides)))).toBe(constraint);
    });

    test('a file is bought once per order: quantity 1, and not twice in one order', async () => {
        const [row] = await db.insert(orders).values(order()).returning();
        const item = {
            orderId: row!.id,
            productId,
            type: 'digital' as const,
            unitPriceCents: 450,
            titleSnapshot: 'Hook',
        };

        expect(await violated(db.insert(orderItems).values({ ...item, quantity: 2 }))).toBe(
            'order_items_digital_quantity_one',
        );
        await db.insert(orderItems).values(item);
        expect(await violated(db.insert(orderItems).values(item))).toBe('order_items_order_product_digital_idx');
    });

    test('a print line keeps its material and choice, and the same model can be printed twice in one order', async () => {
        const [row] = await db
            .insert(orders)
            .values(order({ subtotalCents: 2580, shippingCents: 290, parcelSize: 'S', totalCents: 2870 }))
            .returning();
        const [pla] = await db.insert(materials).values({ name: 'PLA' }).returning();
        const print = {
            orderId: row!.id,
            productId,
            type: 'print' as const,
            unitPriceCents: 1290,
            titleSnapshot: 'Hook',
        };

        expect(await violated(db.insert(orderItems).values(print))).toBe('order_items_print_has_choice');
        const choice = { materialName: 'PLA', colourName: null, colours: [] };
        await db.insert(orderItems).values([
            { ...print, materialId: pla!.id, printSnapshot: choice },
            { ...print, materialId: pla!.id, printSnapshot: { ...choice, colourName: 'Black' } },
        ]);
        // An ordered material can only be made inactive.
        expect(await violated(db.delete(materials).where(eq(materials.id, pla!.id)))).toBe(
            'order_items_material_id_materials_id_fk',
        );
    });

    test('an ordered or owned product cannot be deleted, even by going around the API', async () => {
        const [row] = await db.insert(orders).values(order()).returning();
        await db
            .insert(orderItems)
            .values({ orderId: row!.id, productId, type: 'digital', unitPriceCents: 450, titleSnapshot: 'Hook' });
        expect(await violated(db.delete(products).where(eq(products.id, productId)))).toBe(
            'order_items_product_id_products_id_fk',
        );

        await db.delete(orders);
        await db.insert(entitlements).values({ userId: BUYER_ID, productId });
        expect(await violated(db.delete(products).where(eq(products.id, productId)))).toBe(
            'entitlements_product_id_products_id_fk',
        );
    });

    test('an order outlives its buyer account; what they owned goes with it', async () => {
        const [row] = await db.insert(orders).values(order()).returning();
        await db.insert(entitlements).values({ userId: BUYER_ID, productId, orderId: row!.id });

        await db.delete(users).where(eq(users.id, BUYER_ID));

        const [kept] = await db.select().from(orders).where(eq(orders.id, row!.id));
        expect(kept).toMatchObject({ userId: null, email: 'buyer@example.com' });
        expect(await db.select().from(entitlements)).toEqual([]);
        // Put the buyer back for the other tests.
        await db.insert(users).values({ id: BUYER_ID, email: 'buyer@example.com', role: 'customer' });
    });
});
