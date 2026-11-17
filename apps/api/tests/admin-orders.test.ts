import { fileURLToPath } from 'node:url';

import { adminOrderListSchema, adminOrderSchema, apiErrorSchema, type AdminOrder } from '@app/shared';
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
import { createAdminOrdersService } from '../src/services/admin-orders.ts';
import { bearer, buildApp, tokens } from './helpers.ts';

const ORDER_ID = '0190b6a0-0000-7000-8000-000000000001';

function post(app: ReturnType<typeof buildApp>, path: string, body: unknown, token: string = tokens.admin) {
    return app.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...bearer(token).headers },
        body: JSON.stringify(body),
    });
}

describe('admin orders without a database', () => {
    const app = buildApp();

    test.each([
        ['GET', '/api/admin/orders'],
        ['GET', `/api/admin/orders/${ORDER_ID}`],
        ['POST', `/api/admin/orders/${ORDER_ID}/status`],
    ])('%s %s is for admins only', async (method, path) => {
        const init = {
            method,
            headers: { 'content-type': 'application/json' },
            body: method === 'POST' ? '{}' : undefined,
        };
        expect((await app.request(path, init)).status).toBe(401);
        const asCustomer = await app.request(path, {
            ...init,
            headers: { ...init.headers, ...bearer(tokens.customer).headers },
        });
        expect(asCustomer.status).toBe(403);
    });

    test.each([
        [{ status: 'shipped' }],
        [{ status: 'shipped', carrier: 'Posti', trackingNumber: '   ' }],
        [{ status: 'shipped', carrier: 'Posti', trackingNumber: 'JJFI 123/45' }],
        [{ status: 'shipped', carrier: '', trackingNumber: 'JJFI12345' }],
        [{ status: 'paid' }],
        [{ status: 'cancelled' }],
    ])('refuses a status change %j', async (body) => {
        const res = await post(app, `/api/admin/orders/${ORDER_ID}/status`, body);
        expect(res.status).toBe(400);
    });

    test('refuses an unknown status filter', async () => {
        const res = await app.request('/api/admin/orders?status=lost', bearer(tokens.admin));
        expect(res.status).toBe(400);
    });
});

const url = process.env.TEST_DATABASE_URL;

// Runs against a real Postgres. Start it with `vp run db:up` (local) — CI provides one as a service.
describe.skipIf(!url)('admin orders (integration)', () => {
    const { db, pool } = createDatabase(url ?? '');
    const BUYER_ID = 'user_queue_buyer';
    const CREATOR_ID = 'user_queue_creator';
    let now = new Date('2026-11-18T09:00:00Z');
    const app = buildApp({ adminOrders: createAdminOrdersService(db, { now: () => now }) });
    let productId: string;
    let materialId: string;

    async function reset() {
        await db.delete(entitlements);
        await db.delete(orders);
        await db.delete(products);
        await db.delete(materials);
        await db.delete(categories).where(sql`${categories.parentId} IS NOT NULL`);
        await db.delete(categories);
    }

    /** A paid order: one PLA print of the vase in a medium parcel, unless told otherwise. */
    async function order(overrides: Partial<NewOrder> = {}, name = 'Maija Meikäläinen') {
        const [row] = await db
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
                paidAt: new Date('2026-11-17T10:00:00Z'),
                shippingAddress: {
                    name,
                    phone: '+358401234567',
                    line1: 'Mannerheimintie 1',
                    line2: null,
                    postalCode: '00100',
                    city: 'Helsinki',
                    country: 'FI',
                },
                ...overrides,
            })
            .returning();
        await db.insert(orderItems).values({
            orderId: row!.id,
            productId,
            type: 'print',
            quantity: 2,
            unitPriceCents: 1290,
            titleSnapshot: 'Vase',
            materialId,
            printSnapshot: { materialName: 'PLA', colourName: 'Black', colours: [{ name: 'Black', hex: '#000000' }] },
        });
        return row!;
    }

    async function list(query = '') {
        const res = await app.request(`/api/admin/orders${query}`, bearer(tokens.admin));
        expect(res.status).toBe(200);
        return adminOrderListSchema.parse(await res.json());
    }

    async function move(orderId: string, body: unknown) {
        return post(app, `/api/admin/orders/${orderId}/status`, body);
    }

    async function moved(orderId: string, body: unknown): Promise<AdminOrder> {
        const res = await move(orderId, body);
        expect(res.status).toBe(200);
        return adminOrderSchema.parse(await res.json());
    }

    const ship = { status: 'shipped', carrier: 'Posti', trackingNumber: 'JJFI 1234 5678 9012' };

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
        now = new Date('2026-11-18T09:00:00Z');
        const [product] = await db
            .insert(products)
            .values({ slug: 'vase', title: 'Vase', creatorId: CREATOR_ID, parcelSize: 'M' })
            .returning();
        productId = product!.id;
        const [pla] = await db.insert(materials).values({ name: 'PLA' }).returning();
        materialId = pla!.id;
    });

    afterAll(async () => {
        await reset();
        await db.delete(users).where(inArray(users.id, [BUYER_ID, CREATOR_ID]));
        await pool.end();
    });

    test('an order goes paid → printing → shipped → delivered, keeping when it shipped and arrived', async () => {
        const { id } = await order();

        expect(await moved(id, { status: 'printing' })).toMatchObject({ status: 'printing', shippedAt: null });

        now = new Date('2026-11-19T15:00:00Z');
        expect(await moved(id, ship)).toMatchObject({
            status: 'shipped',
            carrier: 'Posti',
            // Spaces from copying the code are dropped.
            trackingNumber: 'JJFI123456789012',
            shippedAt: '2026-11-19T15:00:00.000Z',
        });

        now = new Date('2026-11-21T12:00:00Z');
        const delivered = await moved(id, { status: 'delivered' });
        expect(delivered).toMatchObject({
            status: 'delivered',
            shippedAt: '2026-11-19T15:00:00.000Z',
            deliveredAt: '2026-11-21T12:00:00.000Z',
        });
        expect(delivered.items).toEqual([
            {
                productId,
                type: 'print',
                title: 'Vase',
                print: { materialName: 'PLA', colourName: 'Black', colours: [{ name: 'Black', hex: '#000000' }] },
                quantity: 2,
                unitPriceCents: 1290,
            },
        ]);
        expect(delivered.shippingAddress).toMatchObject({ name: 'Maija Meikäläinen', phone: '+358401234567' });
    });

    test('printing can be skipped, and a shipped order’s tracking number corrected without changing when it shipped', async () => {
        const { id } = await order();
        await moved(id, ship);

        now = new Date('2026-11-20T08:00:00Z');
        expect(
            await moved(id, { status: 'shipped', carrier: 'Matkahuolto', trackingNumber: 'MH-998877' }),
        ).toMatchObject({
            carrier: 'Matkahuolto',
            trackingNumber: 'MH-998877',
            shippedAt: '2026-11-18T09:00:00.000Z',
        });
    });

    test('asking for the status an order already has changes nothing', async () => {
        const { id } = await order({ status: 'printing' });
        expect(await moved(id, { status: 'printing' })).toMatchObject({ status: 'printing' });
    });

    test.each([
        ['pending', 'printing', { status: 'pending' as const, paidAt: null }, { status: 'printing' }],
        ['cancelled', 'shipped', { status: 'cancelled' as const, paidAt: null }, ship],
        ['refunded', 'shipped', { status: 'refunded' as const }, ship],
        ['paid', 'delivered', {}, { status: 'delivered' }],
        [
            'delivered',
            'printing',
            {
                status: 'delivered' as const,
                carrier: 'Posti',
                trackingNumber: 'JJFI1',
                shippedAt: new Date(),
                deliveredAt: new Date(),
            },
            { status: 'printing' },
        ],
    ])('refuses to move a %s order to %s', async (_, __, overrides, body) => {
        const { id, status } = await order(overrides);

        const res = await move(id, body);

        expect(res.status).toBe(409);
        expect(apiErrorSchema.parse(await res.json()).error.code).toBe('conflict');
        const [unchanged] = await db.select().from(orders).where(eq(orders.id, id));
        expect(unchanged!.status).toBe(status);
    });

    test('orders with only files, and unknown orders, are not in the queue', async () => {
        const files = await order({ parcelSize: null, shippingCents: 0, totalCents: 1290, shippingAddress: null });

        expect((await app.request(`/api/admin/orders/${files.id}`, bearer(tokens.admin))).status).toBe(404);
        expect((await move(files.id, { status: 'printing' })).status).toBe(404);
        expect((await app.request(`/api/admin/orders/${ORDER_ID}`, bearer(tokens.admin))).status).toBe(404);
        expect((await list()).orders).toEqual([]);
    });

    test('lists the work to do oldest first, and filters by status', async () => {
        const later = await order({ paidAt: new Date('2026-11-17T12:00:00Z') });
        const earlier = await order({ status: 'printing', paidAt: new Date('2026-11-16T12:00:00Z') });
        const shipped = await order({
            status: 'shipped',
            carrier: 'Posti',
            trackingNumber: 'JJFI1',
            shippedAt: new Date(),
            paidAt: new Date('2026-11-15T12:00:00Z'),
        });
        const refunded = await order({ status: 'refunded', paidAt: new Date('2026-11-14T12:00:00Z') });
        await order({ status: 'pending', paidAt: null });
        await order({ status: 'cancelled', paidAt: null });

        const open = await list('?status=open');
        expect(open.orders.map((o) => o.id)).toEqual([earlier.id, later.id]);
        expect(open.total).toBe(2);

        expect((await list('?status=shipped')).orders.map((o) => o.id)).toEqual([shipped.id]);
        expect((await list('?status=pending')).total).toBe(1);

        // Everything that was paid for, newest first: not the pending or cancelled ones.
        const all = await list();
        expect(all.orders.map((o) => o.id)).toEqual([later.id, earlier.id, shipped.id, refunded.id]);

        const firstPage = await list('?pageSize=3&page=2');
        expect(firstPage).toMatchObject({ page: 2, pageSize: 3, total: 4 });
        expect(firstPage.orders.map((o) => o.id)).toEqual([refunded.id]);
    });

    test('searches by email, name, tracking number and order id', async () => {
        const maija = await order({}, 'Maija Meikäläinen');
        const matti = await order(
            {
                email: 'matti@example.com',
                status: 'shipped',
                carrier: 'Posti',
                trackingNumber: 'JJFI555',
                shippedAt: new Date(),
            },
            'Matti 100% Virtanen',
        );

        const found = async (q: string) => (await list(`?q=${encodeURIComponent(q)}`)).orders.map((o) => o.id).sort();

        expect(await found('MATTI@')).toEqual([matti.id]);
        expect(await found('meikä')).toEqual([maija.id]);
        expect(await found('jjfi555')).toEqual([matti.id]);
        // The admin shows an order's last 8 characters: uuidv7 ids made close together start alike.
        expect(await found(maija.id.slice(-8))).toEqual([maija.id]);
        // `%` is matched as itself.
        expect(await found('100%')).toEqual([matti.id]);
        expect(await found('%')).toEqual([matti.id]);
    });
});
