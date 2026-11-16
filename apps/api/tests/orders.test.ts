import { fileURLToPath } from 'node:url';

import { apiErrorSchema, checkoutStartSchema, librarySchema, orderSchema, type CartItem } from '@app/shared';
import { eq, inArray, sql } from 'drizzle-orm';
import Stripe from 'stripe';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vite-plus/test';

import { createDatabase, runMigrations } from '../src/db/client.ts';
import {
    categories,
    entitlements,
    orderItems,
    orders,
    productFiles,
    products,
    users,
    type NewProduct,
} from '../src/db/schema.ts';
import {
    createStripePayments,
    type CheckoutState,
    type CreateCheckoutInput,
    type Payments,
} from '../src/integrations/stripe.ts';
import { createCartService } from '../src/services/cart.ts';
import { createLibraryService } from '../src/services/library.ts';
import { CHECKOUT_EXPIRY_MINUTES, createOrdersService } from '../src/services/orders.ts';
import { bearer, buildApp, createFakeStorage, tokens } from './helpers.ts';

const NOW = new Date('2026-11-16T12:00:00Z');
const SITE = 'https://shop.test';
const WEBHOOK_SECRET = 'whsec_test_secret';

/**
 * Stripe Checkout as the tests need it: sessions live in memory, and the test decides what happens to
 * them (paid, expired, failed). Webhook signatures are checked by the real Stripe SDK.
 */
function createFakePayments() {
    const sessions = new Map<string, CheckoutState>();
    const created: CreateCheckoutInput[] = [];
    let count = 0;
    let down = false;
    const update = (id: string, change: Partial<CheckoutState>) => {
        sessions.set(id, { ...sessions.get(id)!, ...change });
    };

    const payments: Payments & {
        created: CreateCheckoutInput[];
        sessions: Map<string, CheckoutState>;
        goDown(): void;
        pay(id: string, change?: Partial<CheckoutState>): void;
        expire(id: string): void;
        failAsync(id: string): void;
    } = {
        created,
        sessions,
        goDown: () => {
            down = true;
        },
        pay: (id, change = {}) =>
            update(id, {
                status: 'complete',
                paid: true,
                paymentStatus: 'paid',
                paymentIntentId: `pi_${id}`,
                paymentMethod: 'card',
                ...change,
            }),
        expire: (id) => update(id, { status: 'expired' }),
        failAsync: (id) => update(id, { status: 'complete', failed: true, paymentStatus: 'unpaid' }),
        async createCheckout(input) {
            if (down) throw new Error('Stripe is down');
            created.push(input);
            const id = `cs_test_${++count}`;
            sessions.set(id, {
                id,
                orderId: input.orderId,
                status: 'open',
                paid: false,
                failed: false,
                paymentStatus: 'unpaid',
                amountTotalCents: input.lines.reduce((sum, line) => sum + line.unitAmountCents * line.quantity, 0),
                currency: 'eur',
                paymentIntentId: null,
                paymentMethod: null,
            });
            return { id, url: `https://checkout.stripe.test/c/pay/${id}` };
        },
        async getCheckout(id) {
            const session = sessions.get(id);
            if (!session) throw new Error(`No such checkout.session: ${id}`);
            return { ...session };
        },
        verifyWebhook: createStripePayments({ secretKey: 'sk_test_unused', webhookSecret: WEBHOOK_SECRET })
            .verifyWebhook,
    };
    return payments;
}

describe('checkout and orders without a database', () => {
    const app = buildApp();

    test('checkout needs a signed-in buyer', async () => {
        const res = await app.request('/api/checkout', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ items: [] }),
        });
        expect(res.status).toBe(401);
    });

    test('an empty cart is not a checkout', async () => {
        const res = await app.request('/api/checkout', {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...bearer(tokens.customer).headers },
            body: JSON.stringify({ items: [] }),
        });
        expect(res.status).toBe(400);
    });

    test("the Stripe webhook answers 503 when it isn't configured", async () => {
        const res = await app.request('/api/webhooks/stripe', { method: 'POST', body: '{}' });
        expect(res.status).toBe(503);
    });
});

const url = process.env.TEST_DATABASE_URL;

// Runs against a real Postgres. Start it with `vp run db:up` (local) — CI provides one as a service.
describe.skipIf(!url)('checkout and orders (integration)', () => {
    const { db, pool } = createDatabase(url ?? '');
    const CREATOR_ID = 'user_orders_creator';
    /** The users behind `tokens.customer` and `tokens.admin`. */
    const BUYER_ID = 'user_customer';
    const OTHER_ID = 'user_admin';
    const storage = createFakeStorage();
    const cart = createCartService(db, storage);
    let payments: ReturnType<typeof createFakePayments>;
    let app: ReturnType<typeof buildApp>;
    let categoryId: string;

    function appWith(paymentsOrNull: Payments | null) {
        return buildApp({
            cart,
            orders: createOrdersService(db, cart, paymentsOrNull, { siteUrl: SITE, now: () => NOW }),
            library: createLibraryService(db, storage),
            verifyStripeWebhook: paymentsOrNull?.verifyWebhook ?? null,
        });
    }

    async function resetCatalogue() {
        await db.delete(entitlements);
        await db.delete(orders);
        await db.delete(products);
        await db.delete(categories).where(sql`${categories.parentId} IS NOT NULL`);
        await db.delete(categories);
    }

    /** A published product with a paid file and one download. */
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
        const [file] = await db
            .insert(productFiles)
            .values({
                productId: product!.id,
                kind: 'download',
                format: 'stl',
                filename: `${product!.slug}.stl`,
                storageKey: `products/${product!.id}/files/model.stl`,
                sizeBytes: 1000,
            })
            .returning();
        return { ...product!, file: file! };
    }

    const digital = (productId: string): CartItem => ({ productId, type: 'digital' });

    function checkout(items: CartItem[], token: string = tokens.customer, target = app) {
        return target.request('/api/checkout', {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...bearer(token).headers },
            body: JSON.stringify({ items }),
        });
    }

    async function startCheckout(items: CartItem[]) {
        const res = await checkout(items);
        expect(res.status).toBe(201);
        const start = checkoutStartSchema.parse(await res.json());
        const [order] = await db.select().from(orders).where(eq(orders.id, start.orderId));
        return { ...start, sessionId: order!.stripeCheckoutSessionId! };
    }

    async function getOrder(orderId: string, token: string = tokens.customer) {
        return app.request(`/api/orders/${orderId}`, bearer(token));
    }

    async function signedWebhook(payload: object, secret = WEBHOOK_SECRET) {
        const body = JSON.stringify(payload);
        const signature = await Stripe.webhooks.generateTestHeaderStringAsync({ payload: body, secret });
        return app.request('/api/webhooks/stripe', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'stripe-signature': signature },
            body,
        });
    }

    const sessionEvent = (type: string, sessionId: string) => ({
        id: `evt_${Math.random().toString(36).slice(2)}`,
        object: 'event',
        type,
        data: { object: { id: sessionId, object: 'checkout.session' } },
    });

    const ownedBy = async (userId: string) =>
        (await db.select().from(entitlements).where(eq(entitlements.userId, userId))).map((row) => row.productId);

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
        payments = createFakePayments();
        app = appWith(payments);
    });

    afterAll(async () => {
        await resetCatalogue();
        await db.delete(users).where(inArray(users.id, [CREATOR_ID, BUYER_ID, OTHER_ID]));
        await pool.end();
    });

    describe('checkout', () => {
        test('creates a pending order with snapshots, and a Stripe session for exactly its amounts', async () => {
            const hook = await model({ title: 'Hook', digitalPriceCents: 450 });
            const stand = await model({ title: 'Stand', digitalPriceCents: 1290, license: 'commercial' });

            const start = await startCheckout([digital(hook.id), digital(stand.id)]);

            expect(start.paymentUrl).toBe(`https://checkout.stripe.test/c/pay/${start.sessionId}`);
            const [order] = await db.select().from(orders).where(eq(orders.id, start.orderId));
            expect(order).toMatchObject({
                userId: BUYER_ID,
                email: 'buyer@example.com',
                status: 'pending',
                subtotalCents: 1740,
                totalCents: 1740,
                taxCents: 354,
                vatCountry: 'FI',
                vatRateBp: 2550,
                paidAt: null,
            });
            const items = await db.select().from(orderItems).where(eq(orderItems.orderId, start.orderId));
            expect(
                items.map(({ productId, titleSnapshot, unitPriceCents, licenseSnapshot, quantity }) => ({
                    productId,
                    titleSnapshot,
                    unitPriceCents,
                    licenseSnapshot,
                    quantity,
                })),
            ).toEqual([
                {
                    productId: hook.id,
                    titleSnapshot: 'Hook',
                    unitPriceCents: 450,
                    licenseSnapshot: 'standard_digital',
                    quantity: 1,
                },
                {
                    productId: stand.id,
                    titleSnapshot: 'Stand',
                    unitPriceCents: 1290,
                    licenseSnapshot: 'commercial',
                    quantity: 1,
                },
            ]);

            expect(payments.created).toEqual([
                {
                    orderId: start.orderId,
                    email: 'buyer@example.com',
                    lines: [
                        { name: 'Hook', unitAmountCents: 450, quantity: 1 },
                        { name: 'Stand', unitAmountCents: 1290, quantity: 1 },
                    ],
                    successUrl: `${SITE}/orders/${start.orderId}`,
                    cancelUrl: `${SITE}/cart`,
                    expiresAt: new Date(NOW.getTime() + CHECKOUT_EXPIRY_MINUTES * 60_000),
                },
            ]);
        });

        test('refuses a cart that changed, and creates nothing', async () => {
            const archived = await model({ status: 'archived' });
            const owned = await model();
            await db.insert(entitlements).values({ userId: BUYER_ID, productId: owned.id });

            for (const items of [[digital(archived.id)], [digital(owned.id)]]) {
                const res = await checkout(items);
                expect(res.status).toBe(409);
                expect(apiErrorSchema.parse(await res.json()).error).toMatchObject({
                    message: 'Your cart has changed. Check it and try again.',
                    issues: [{ path: 'items', message: 'Your cart has changed. Check it and try again.' }],
                });
            }
            expect(await db.select().from(orders)).toEqual([]);
            expect(payments.created).toEqual([]);
        });

        test("waits for the account to reach the database (Clerk's webhook)", async () => {
            const hook = await model();
            await db.delete(users).where(eq(users.id, BUYER_ID));
            try {
                const res = await checkout([digital(hook.id)]);
                expect(res.status).toBe(409);
            } finally {
                await db.insert(users).values({ id: BUYER_ID, email: 'buyer@example.com', role: 'customer' });
            }
        });

        test('answers 503 without Stripe, and 502 if Stripe fails, keeping no order', async () => {
            const hook = await model();
            expect((await checkout([digital(hook.id)], tokens.customer, appWith(null))).status).toBe(503);

            payments.goDown();
            const res = await checkout([digital(hook.id)]);
            expect(res.status).toBe(502);
            expect(await db.select().from(orders)).toEqual([]);
        });
    });

    describe('the order page', () => {
        test('is only for the buyer', async () => {
            const hook = await model();
            const { orderId } = await startCheckout([digital(hook.id)]);
            expect((await getOrder(orderId, tokens.admin)).status).toBe(404);
            expect((await app.request(`/api/orders/${orderId}`)).status).toBe(401);
        });

        test('shows a pending order without files', async () => {
            const hook = await model();
            const { orderId } = await startCheckout([digital(hook.id)]);

            const res = await getOrder(orderId);
            expect(res.status).toBe(200);
            expect(res.headers.get('cache-control')).toBe('no-store');
            const order = orderSchema.parse(await res.json());
            expect(order).toMatchObject({ status: 'pending', totalCents: 450, paidAt: null });
            expect(order.items).toEqual([
                {
                    productId: hook.id,
                    type: 'digital',
                    title: 'Hook',
                    slug: hook.slug,
                    unitPriceCents: 450,
                    quantity: 1,
                    files: [],
                },
            ]);
        });

        test('asks Stripe when the buyer is back before the webhook: paid, owned, with files', async () => {
            const hook = await model();
            const { orderId, sessionId } = await startCheckout([digital(hook.id)]);
            payments.pay(sessionId, { paymentMethod: 'mobilepay' });

            const order = orderSchema.parse(await (await getOrder(orderId)).json());

            expect(order).toMatchObject({ status: 'paid', paidAt: NOW.toISOString() });
            expect(order.items[0]!.files).toEqual([
                { id: hook.file.id, format: 'stl', filename: `${hook.slug}.stl`, sizeBytes: 1000 },
            ]);
            expect(await ownedBy(BUYER_ID)).toEqual([hook.id]);
            const [row] = await db.select().from(orders).where(eq(orders.id, orderId));
            expect(row).toMatchObject({
                paymentStatus: 'paid',
                paymentMethod: 'mobilepay',
                stripePaymentIntentId: `pi_${sessionId}`,
            });
        });

        test('an expired or failed payment cancels the order and grants nothing', async () => {
            const hook = await model();
            const expired = await startCheckout([digital(hook.id)]);
            payments.expire(expired.sessionId);
            const failed = await startCheckout([digital(hook.id)]);
            payments.failAsync(failed.sessionId);

            for (const { orderId } of [expired, failed]) {
                expect(orderSchema.parse(await (await getOrder(orderId)).json()).status).toBe('cancelled');
            }
            expect(await ownedBy(BUYER_ID)).toEqual([]);
        });

        test('a payment that is still being processed keeps the order pending', async () => {
            const hook = await model();
            const { orderId, sessionId } = await startCheckout([digital(hook.id)]);
            payments.sessions.set(sessionId, { ...payments.sessions.get(sessionId)!, status: 'complete' });

            expect(orderSchema.parse(await (await getOrder(orderId)).json()).status).toBe('pending');
        });

        test('is never marked paid for an amount other than its own', async () => {
            const hook = await model();
            const { orderId, sessionId } = await startCheckout([digital(hook.id)]);
            payments.pay(sessionId, { amountTotalCents: 1 });

            expect(orderSchema.parse(await (await getOrder(orderId)).json()).status).toBe('pending');
            expect(await ownedBy(BUYER_ID)).toEqual([]);
        });
    });

    describe('the Stripe webhook', () => {
        test('rejects a missing or wrong signature', async () => {
            const missing = await app.request('/api/webhooks/stripe', { method: 'POST', body: '{}' });
            expect(missing.status).toBe(400);

            const wrong = await signedWebhook(sessionEvent('checkout.session.completed', 'cs_x'), 'whsec_wrong');
            expect(wrong.status).toBe(400);
            expect(apiErrorSchema.parse(await wrong.json()).error.message).toBe('Invalid webhook signature.');
        });

        test('a paid session marks the order paid and grants the files, once however often it arrives', async () => {
            const hook = await model();
            const stand = await model();
            const { orderId, sessionId } = await startCheckout([digital(hook.id), digital(stand.id)]);
            payments.pay(sessionId);

            for (let delivery = 0; delivery < 3; delivery++) {
                const res = await signedWebhook(sessionEvent('checkout.session.completed', sessionId));
                expect(res.status).toBe(200);
            }

            const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
            expect(order).toMatchObject({ status: 'paid', paidAt: NOW });
            expect((await ownedBy(BUYER_ID)).toSorted()).toEqual([hook.id, stand.id].toSorted());
            const grants = await db.select().from(entitlements).where(eq(entitlements.orderId, orderId));
            expect(grants).toHaveLength(2);
        });

        test("a paid purchase shows up in the buyer's library, ready to download", async () => {
            const hook = await model({ title: 'Hook' });
            const { orderId, sessionId } = await startCheckout([digital(hook.id)]);
            const library = async () =>
                librarySchema.parse(await (await app.request('/api/library', bearer(tokens.customer))).json()).items;
            expect(await library()).toEqual([]);

            payments.pay(sessionId);
            expect((await signedWebhook(sessionEvent('checkout.session.completed', sessionId))).status).toBe(200);

            expect(await library()).toMatchObject([
                { productId: hook.id, title: 'Hook', listed: true, orderId, files: [{ id: hook.file.id }] },
            ]);
        });

        test('an expired session cancels the order', async () => {
            const hook = await model();
            const { orderId, sessionId } = await startCheckout([digital(hook.id)]);
            payments.expire(sessionId);

            expect((await signedWebhook(sessionEvent('checkout.session.expired', sessionId))).status).toBe(200);
            const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
            expect(order!.status).toBe('cancelled');
        });

        test("a cancelled order isn't paid later by a stale event", async () => {
            const hook = await model();
            const { orderId, sessionId } = await startCheckout([digital(hook.id)]);
            payments.expire(sessionId);
            await signedWebhook(sessionEvent('checkout.session.expired', sessionId));
            payments.pay(sessionId);

            await signedWebhook(sessionEvent('checkout.session.completed', sessionId));
            const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
            expect(order!.status).toBe('cancelled');
            expect(await ownedBy(BUYER_ID)).toEqual([]);
        });

        test("acknowledges events it doesn't handle, and sessions from another environment", async () => {
            expect((await signedWebhook(sessionEvent('customer.created', 'cus_1'))).status).toBe(200);
            expect((await signedWebhook(sessionEvent('checkout.session.completed', 'cs_elsewhere'))).status).toBe(200);
        });

        test('a buyer whose account is gone gets the order paid, but nobody gets the files', async () => {
            const hook = await model();
            const { orderId, sessionId } = await startCheckout([digital(hook.id)]);
            await db.update(orders).set({ userId: null }).where(eq(orders.id, orderId));
            payments.pay(sessionId);

            await signedWebhook(sessionEvent('checkout.session.completed', sessionId));
            const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
            expect(order!.status).toBe('paid');
            expect(await db.select().from(entitlements)).toEqual([]);
        });
    });
});
