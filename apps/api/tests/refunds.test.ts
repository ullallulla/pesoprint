import { fileURLToPath } from 'node:url';

import { adminOrderSchema, apiErrorSchema } from '@app/shared';
import { eq, inArray, sql } from 'drizzle-orm';
import Stripe from 'stripe';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vite-plus/test';

import { createDatabase, runMigrations } from '../src/db/client.ts';
import {
    categories,
    entitlements,
    materials,
    orderEmails,
    orderItems,
    orders,
    products,
    users,
    type NewOrder,
} from '../src/db/schema.ts';
import { orderRefundedEmail } from '../src/emails/order-emails.ts';
import { createStripePayments, RefundError, type Payments } from '../src/integrations/stripe.ts';
import { createAdminOrdersService } from '../src/services/admin-orders.ts';
import { createRefundsService } from '../src/services/refunds.ts';
import { bearer, buildApp, tokens } from './helpers.ts';

const WEBHOOK_SECRET = 'whsec_test_refunds';
const ORDER_ID = '0190b6a0-0000-7000-8000-000000000001';

async function signed(payload: object) {
    const body = JSON.stringify(payload);
    const signature = await Stripe.webhooks.generateTestHeaderStringAsync({ payload: body, secret: WEBHOOK_SECRET });
    return { body, signature };
}

const event = (type: string, object: object) => ({
    id: `evt_${Math.random().toString(36).slice(2)}`,
    object: 'event',
    type,
    data: { object },
});

describe('refund webhooks', () => {
    const { verifyWebhook } = createStripePayments({ secretKey: 'sk_test_unused', webhookSecret: WEBHOOK_SECRET });

    test.each([
        ['charge.refunded', { object: 'charge', id: 'ch_1', payment_intent: 'pi_1' }],
        ['charge.refund.updated', { object: 'refund', id: 're_1', payment_intent: 'pi_1' }],
    ])('%s names the payment that was refunded', async (type, object) => {
        const { body, signature } = await signed(event(type, object));
        expect(await verifyWebhook!(body, signature)).toEqual({ kind: 'refund', paymentIntentId: 'pi_1' });
    });

    test('checkout events still name the session', async () => {
        const { body, signature } = await signed(
            event('checkout.session.completed', { object: 'checkout.session', id: 'cs_1' }),
        );
        expect(await verifyWebhook!(body, signature)).toEqual({ kind: 'checkout', sessionId: 'cs_1' });
    });

    test('other events are ignored', async () => {
        const { body, signature } = await signed(
            event('charge.succeeded', { object: 'charge', payment_intent: 'pi_1' }),
        );
        expect(await verifyWebhook!(body, signature)).toBeNull();
    });
});

describe('the refund email', () => {
    test('says how much was refunded, and that files left the library', () => {
        const email = orderRefundedEmail(
            {
                order: {
                    id: '0190b6a0-0000-7000-8000-00000000abcd',
                    subtotalCents: 450,
                    shippingCents: 0,
                    parcelSize: null,
                    totalCents: 450,
                    taxCents: 91,
                    vatRateBp: 2550,
                    shippingAddress: null,
                    carrier: null,
                    trackingNumber: null,
                    immediateDeliveryConsentAt: null,
                    paidAt: null,
                    refundedCents: 450,
                },
                items: [
                    {
                        type: 'digital',
                        titleSnapshot: 'Hook',
                        printSnapshot: null,
                        quantity: 1,
                        unitPriceCents: 450,
                    },
                ],
            },
            { siteUrl: 'https://shop.test' },
        );
        expect(email.subject).toBe('Your Pesoprint order 0000ABCD has been refunded');
        expect(email.text).toContain("We've refunded €4.50 for your order 0000ABCD");
        expect(email.text).toContain('removed from your library');
    });
});

describe('refunds without a database', () => {
    const app = buildApp();

    test('refunding is for admins only', async () => {
        const path = `/api/admin/orders/${ORDER_ID}/refund`;
        expect((await app.request(path, { method: 'POST' })).status).toBe(401);
        expect((await app.request(path, { method: 'POST', ...bearer(tokens.customer) })).status).toBe(403);
    });
});

/**
 * Stripe's refunds as the tests need them: each payment remembers how much was refunded. `refundInDashboard`
 * stands in for a refund made in Stripe's dashboard; `refuseNext` for Stripe refusing one.
 */
function createFakeRefunds() {
    const refunded = new Map<string, number>();
    /** Each payment's `order_id` metadata. */
    const orderIds = new Map<string, string>();
    let afterNextRead: (() => void) | null = null;
    const requests: { paymentIntentId: string; amountCents: number; idempotencyKey: string }[] = [];
    const seenKeys = new Set<string>();
    let refusal: string | null = null;
    const payments: Payments & {
        requests: typeof requests;
        refundInDashboard(paymentIntentId: string, amountCents: number): void;
        refuseNext(message: string): void;
        paysFor(paymentIntentId: string, orderId: string): void;
        /** Runs once, right after the next `getRefunds` read its answer: something changing at that moment. */
        afterNextRead(run: () => void): void;
    } = {
        requests,
        paysFor: (id, orderId) => orderIds.set(id, orderId),
        afterNextRead: (run) => {
            afterNextRead = run;
        },
        refundInDashboard: (id, amount) => refunded.set(id, (refunded.get(id) ?? 0) + amount),
        refuseNext: (message) => {
            refusal = message;
        },
        createCheckout: () => Promise.reject(new Error('not used')),
        getCheckout: () => Promise.reject(new Error('not used')),
        async refund(request) {
            requests.push(request);
            if (refusal) {
                const message = refusal;
                refusal = null;
                throw new RefundError(message);
            }
            // Like Stripe: a repeated key returns the first refund instead of making another.
            if (seenKeys.has(request.idempotencyKey)) return;
            seenKeys.add(request.idempotencyKey);
            payments.refundInDashboard(request.paymentIntentId, request.amountCents);
        },
        async getRefunds(id) {
            const answer = { refundedCents: refunded.get(id) ?? 0, orderId: orderIds.get(id) ?? null };
            const run = afterNextRead;
            afterNextRead = null;
            run?.();
            return answer;
        },
        verifyWebhook: createStripePayments({ secretKey: 'sk_test_unused', webhookSecret: WEBHOOK_SECRET })
            .verifyWebhook,
    };
    return payments;
}

const url = process.env.TEST_DATABASE_URL;

// Runs against a real Postgres. Start it with `vp run db:up` (local) — CI provides one as a service.
describe.skipIf(!url)('refunds (integration)', () => {
    const { db, pool } = createDatabase(url ?? '');
    const BUYER_ID = 'user_refund_buyer';
    const CREATOR_ID = 'user_refund_creator';
    const NOW = new Date('2026-11-20T09:00:00Z');
    let payments: ReturnType<typeof createFakeRefunds>;
    let queued: string[];
    let app: ReturnType<typeof buildApp>;
    let fileProductId: string;
    let printProductId: string;
    let materialId: string;

    async function reset() {
        await db.delete(entitlements);
        await db.delete(orders);
        await db.delete(products);
        await db.delete(materials);
        await db.delete(categories).where(sql`${categories.parentId} IS NOT NULL`);
        await db.delete(categories);
    }

    /** A shipped order of a file (€4.50) and a print (€12.90) plus shipping (€4.90): €22.30. Files are granted. */
    async function shippedOrder(overrides: Partial<NewOrder> = {}, { withPrint = true } = {}) {
        const [order] = await db
            .insert(orders)
            .values({
                userId: BUYER_ID,
                email: 'buyer@example.com',
                status: withPrint ? 'shipped' : 'paid',
                subtotalCents: withPrint ? 1740 : 450,
                shippingCents: withPrint ? 490 : 0,
                parcelSize: withPrint ? 'M' : null,
                taxCents: 0,
                totalCents: withPrint ? 2230 : 450,
                vatCountry: 'FI',
                vatRateBp: 2550,
                stripePaymentIntentId: `pi_${Math.random().toString(36).slice(2)}`,
                paidAt: new Date('2026-11-17T10:00:00Z'),
                ...(withPrint && {
                    carrier: 'Posti',
                    trackingNumber: 'JJFI1',
                    shippedAt: new Date('2026-11-18T10:00:00Z'),
                }),
                ...overrides,
            })
            .returning();
        await db.insert(orderItems).values([
            {
                orderId: order!.id,
                productId: fileProductId,
                type: 'digital',
                unitPriceCents: 450,
                titleSnapshot: 'Hook',
                licenseSnapshot: 'standard_digital',
            },
            ...(withPrint
                ? [
                      {
                          orderId: order!.id,
                          productId: printProductId,
                          type: 'print' as const,
                          unitPriceCents: 1290,
                          titleSnapshot: 'Vase',
                          materialId,
                          printSnapshot: { materialName: 'PLA', colourName: null, colours: [] },
                      },
                  ]
                : []),
        ]);
        // Owned already (a second order in the same test): the first order stays the record.
        await db
            .insert(entitlements)
            .values({ userId: BUYER_ID, productId: fileProductId, orderId: order!.id })
            .onConflictDoNothing();
        return order!;
    }

    const reload = async (orderId: string) => (await db.select().from(orders).where(eq(orders.id, orderId)))[0]!;
    const owned = async () => db.select().from(entitlements).where(eq(entitlements.userId, BUYER_ID));
    const emailsOf = (orderId: string) => db.select().from(orderEmails).where(eq(orderEmails.orderId, orderId));

    const refund = (orderId: string) =>
        app.request(`/api/admin/orders/${orderId}/refund`, { method: 'POST', ...bearer(tokens.admin) });

    async function webhook(paymentIntentId: string, type = 'charge.refunded') {
        const { body, signature } = await signed(event(type, { object: 'charge', payment_intent: paymentIntentId }));
        return app.request('/api/webhooks/stripe', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'stripe-signature': signature },
            body,
        });
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
        payments = createFakeRefunds();
        queued = [];
        const refunds = createRefundsService(db, payments, {
            now: () => NOW,
            onEmailQueued: (orderId) => queued.push(orderId),
        });
        app = buildApp({
            adminOrders: createAdminOrdersService(db),
            refunds,
            verifyStripeWebhook: payments.verifyWebhook,
        });
        const [file] = await db
            .insert(products)
            .values({ slug: 'hook', title: 'Hook', creatorId: CREATOR_ID })
            .returning();
        const [print] = await db
            .insert(products)
            .values({ slug: 'vase', title: 'Vase', creatorId: CREATOR_ID, parcelSize: 'M' })
            .returning();
        fileProductId = file!.id;
        printProductId = print!.id;
        const [pla] = await db.insert(materials).values({ name: 'PLA' }).returning();
        materialId = pla!.id;
    });

    afterAll(async () => {
        await reset();
        await db.delete(users).where(inArray(users.id, [BUYER_ID, CREATOR_ID]));
        await pool.end();
    });

    test('the admin refunds a whole order: Stripe refunds the total, the files are taken back, the buyer is emailed', async () => {
        const order = await shippedOrder();

        const res = await refund(order.id);

        expect(res.status).toBe(200);
        expect(adminOrderSchema.parse(await res.json())).toMatchObject({
            status: 'refunded',
            refundedCents: 2230,
            refundedAt: NOW.toISOString(),
            // What happened before stays on record.
            trackingNumber: 'JJFI1',
        });
        expect(payments.requests).toEqual([
            {
                paymentIntentId: order.stripePaymentIntentId,
                amountCents: 2230,
                idempotencyKey: `refund-${order.id}-0`,
            },
        ]);
        expect(await owned()).toEqual([]);
        expect(await emailsOf(order.id)).toEqual([expect.objectContaining({ kind: 'order_refunded' })]);
        expect(queued).toEqual([order.id]);
    });

    test("refunding twice refunds once, and the buyer's other purchases stay theirs", async () => {
        const order = await shippedOrder();
        const [other] = await db
            .insert(products)
            .values({ slug: 'stand', title: 'Stand', creatorId: CREATOR_ID })
            .returning();
        await db.insert(entitlements).values({ userId: BUYER_ID, productId: other!.id, orderId: null });

        const [first, second] = await Promise.all([refund(order.id), refund(order.id)]);
        expect([first.status, second.status]).toEqual([200, 200]);
        expect((await refund(order.id)).status).toBe(200);

        // Both clicks reached Stripe with the same key, so Stripe made one refund.
        expect(new Set(payments.requests.map((request) => request.idempotencyKey)).size).toBe(1);
        expect((await payments.getRefunds(order.stripePaymentIntentId!)).refundedCents).toBe(2230);
        expect((await owned()).map((row) => row.productId)).toEqual([other!.id]);
        expect(queued).toEqual([order.id]);
    });

    test("an order that wasn't paid can't be refunded, and files-only orders aren't the admin's", async () => {
        const pending = await shippedOrder({
            status: 'pending',
            paidAt: null,
            carrier: null,
            trackingNumber: null,
            shippedAt: null,
        });
        const res = await refund(pending.id);
        expect(res.status).toBe(409);
        expect(apiErrorSchema.parse(await res.json()).error.message).toContain("wasn't paid");

        const filesOnly = await shippedOrder({}, { withPrint: false });
        expect((await refund(filesOnly.id)).status).toBe(404);
        expect(payments.requests).toEqual([]);
    });

    test("Stripe's refusal is passed on, and the order stays as it was", async () => {
        const order = await shippedOrder();
        payments.refuseNext('Charge ch_1 has already been refunded.');

        const res = await refund(order.id);

        expect(res.status).toBe(502);
        expect(apiErrorSchema.parse(await res.json()).error.message).toBe(
            "Stripe didn't make the refund: Charge ch_1 has already been refunded.",
        );
        expect(await reload(order.id)).toMatchObject({ status: 'shipped', refundedCents: 0 });
        expect(await owned()).toHaveLength(1);
    });

    test('refunds made in Stripe’s dashboard are recorded from the webhook: partly, then in full', async () => {
        const order = await shippedOrder();
        const intent = order.stripePaymentIntentId!;

        payments.refundInDashboard(intent, 490);
        expect((await webhook(intent)).status).toBe(200);
        expect(await reload(order.id)).toMatchObject({ status: 'shipped', refundedCents: 490, refundedAt: null });
        expect(await owned()).toHaveLength(1);
        expect(queued).toEqual([]);

        payments.refundInDashboard(intent, 1740);
        expect((await webhook(intent, 'charge.refund.updated')).status).toBe(200);
        expect((await webhook(intent)).status).toBe(200);
        expect(await reload(order.id)).toMatchObject({ status: 'refunded', refundedCents: 2230, refundedAt: NOW });
        expect(await owned()).toEqual([]);
        expect(queued).toEqual([order.id]);
    });

    test('after a partial refund in the dashboard, the admin refunds what is left', async () => {
        const order = await shippedOrder();
        payments.refundInDashboard(order.stripePaymentIntentId!, 490);
        await webhook(order.stripePaymentIntentId!);

        expect((await refund(order.id)).status).toBe(200);

        expect(payments.requests).toEqual([
            expect.objectContaining({ amountCents: 1740, idempotencyKey: `refund-${order.id}-490` }),
        ]);
        expect(await reload(order.id)).toMatchObject({ status: 'refunded', refundedCents: 2230 });
    });

    test("the admin's refund and Stripe's webhook arriving together refund the order once", async () => {
        const order = await shippedOrder();

        await Promise.all([
            refund(order.id),
            webhook(order.stripePaymentIntentId!),
            webhook(order.stripePaymentIntentId!),
        ]);

        expect(await reload(order.id)).toMatchObject({ status: 'refunded', refundedCents: 2230 });
        expect(await emailsOf(order.id)).toHaveLength(1);
        expect(queued).toEqual([order.id]);
    });

    test('a refund of an order not yet recorded as paid fails, so Stripe delivers it again later', async () => {
        const order = await shippedOrder({
            status: 'pending',
            paidAt: null,
            carrier: null,
            trackingNumber: null,
            shippedAt: null,
        });
        payments.refundInDashboard(order.stripePaymentIntentId!, 2230);

        expect((await webhook(order.stripePaymentIntentId!)).status).toBe(500);
        expect(await reload(order.id)).toMatchObject({ status: 'pending', refundedCents: 0 });
    });

    test('a partial and a full refund whose webhooks overlap end with the order refunded', async () => {
        const order = await shippedOrder();
        const intent = order.stripePaymentIntentId!;
        payments.refundInDashboard(intent, 490);
        let second: Promise<Response> | undefined;
        // The rest is refunded, and its webhook arrives, while the first webhook is still being handled.
        payments.afterNextRead(() => {
            payments.refundInDashboard(intent, 1740);
            second = webhook(intent);
        });

        expect((await webhook(intent)).status).toBe(200);
        expect((await second!).status).toBe(200);

        expect(await reload(order.id)).toMatchObject({ status: 'refunded', refundedCents: 2230 });
        expect(await owned()).toEqual([]);
        expect(queued).toEqual([order.id]);
    });

    test('refunding one of two orders that bought the same file leaves the file with the buyer', async () => {
        const first = await shippedOrder({}, { withPrint: false });
        const second = await shippedOrder({ paidAt: new Date('2026-11-17T10:05:00Z') }, { withPrint: false });
        expect(await owned()).toEqual([expect.objectContaining({ orderId: first.id })]);

        payments.refundInDashboard(first.stripePaymentIntentId!, 450);
        expect((await webhook(first.stripePaymentIntentId!)).status).toBe(200);

        expect(await reload(first.id)).toMatchObject({ status: 'refunded' });
        expect(await owned()).toEqual([expect.objectContaining({ productId: fileProductId, orderId: second.id })]);

        // Refunding the other one too takes the file back.
        payments.refundInDashboard(second.stripePaymentIntentId!, 450);
        expect((await webhook(second.stripePaymentIntentId!)).status).toBe(200);
        expect(await owned()).toEqual([]);
    });

    test('a refund that arrives before the payment is recorded finds its order through the metadata', async () => {
        const intent = 'pi_refunded_before_paid';
        const order = await shippedOrder({
            status: 'pending',
            paidAt: null,
            carrier: null,
            trackingNumber: null,
            shippedAt: null,
            stripePaymentIntentId: null,
        });
        payments.paysFor(intent, order.id);
        payments.refundInDashboard(intent, 2230);

        // Not acknowledged, so Stripe delivers it again...
        expect((await webhook(intent)).status).toBe(500);
        expect(await reload(order.id)).toMatchObject({ status: 'pending', refundedCents: 0 });

        // ...after the payment's own webhook has recorded it.
        await db
            .update(orders)
            .set({ status: 'paid', paidAt: NOW, stripePaymentIntentId: intent })
            .where(eq(orders.id, order.id));
        expect((await webhook(intent)).status).toBe(200);
        expect(await reload(order.id)).toMatchObject({ status: 'refunded', refundedCents: 2230 });
        expect(await owned()).toEqual([]);
    });

    test('a refund webhook for a payment no order here has is acknowledged and ignored', async () => {
        expect((await webhook('pi_from_another_environment')).status).toBe(200);
    });
});
