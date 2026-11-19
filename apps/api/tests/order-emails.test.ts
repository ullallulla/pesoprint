import { fileURLToPath } from 'node:url';

import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vite-plus/test';

import { createDatabase, runMigrations } from '../src/db/client.ts';
import {
    categories,
    materials,
    orderEmails,
    orderItems,
    orders,
    products,
    users,
    type NewOrder,
} from '../src/db/schema.ts';
import {
    orderConfirmationEmail,
    orderReference,
    orderShippedEmail,
    type OrderEmailInput,
} from '../src/emails/order-emails.ts';
import type { EmailMessage, Mailer } from '../src/integrations/email.ts';
import type { CheckoutState, Payments } from '../src/integrations/stripe.ts';
import { createAdminOrdersService } from '../src/services/admin-orders.ts';
import type { CartService } from '../src/services/cart.ts';
import { createOrderEmailsService, MAX_ATTEMPTS, RETRY_AFTER_MS } from '../src/services/order-emails.ts';
import { createOrdersService } from '../src/services/orders.ts';

const SITE = 'https://shop.test';
const ORDER_ID = '0190b6a0-0000-7000-8000-00000000abcd';

const address = {
    name: 'Maija Meikäläinen',
    phone: '+358401234567',
    line1: 'Mannerheimintie 1',
    line2: null,
    postalCode: '00100',
    city: 'Helsinki',
    country: 'FI',
};

type Item = OrderEmailInput['items'][number];

const fileItem: Item = {
    type: 'digital',
    titleSnapshot: 'Cable hook',
    printSnapshot: null,
    quantity: 1,
    unitPriceCents: 450,
};

const printItem: Item = {
    type: 'print',
    titleSnapshot: 'Vase',
    printSnapshot: { materialName: 'PLA', colourName: 'Black', colours: [{ name: 'Black', hex: '#000000' }] },
    quantity: 2,
    unitPriceCents: 1290,
};

function input(overrides: Partial<OrderEmailInput['order']> = {}, items: OrderEmailInput['items'] = [fileItem]) {
    return {
        order: {
            id: ORDER_ID,
            subtotalCents: 450,
            shippingCents: 0,
            parcelSize: null,
            totalCents: 450,
            taxCents: 91,
            vatRateBp: 2550,
            shippingAddress: null,
            carrier: null,
            trackingNumber: null,
            immediateDeliveryConsentAt: new Date('2026-11-18T10:00:00Z'),
            paidAt: new Date('2026-11-18T10:01:00Z'),
            refundedCents: 0,
            ...overrides,
        },
        items,
    } satisfies OrderEmailInput;
}

describe('order email templates', () => {
    test('an order reference is the random end of the id', () => {
        expect(orderReference(ORDER_ID)).toBe('0000ABCD');
    });

    test('the confirmation of files links to the library and records the waived right of withdrawal', () => {
        const email = orderConfirmationEmail(input(), { siteUrl: SITE, subjectPrefix: '[Staging] ' });

        expect(email.subject).toBe('[Staging] Your Pesoprint order 0000ABCD');
        for (const body of [email.text, email.html]) {
            expect(body).toContain(`${SITE}/library`);
            expect(body).toContain(`${SITE}/orders/${ORDER_ID}`);
            expect(body).toContain('18 November 2026');
            expect(body).toContain('lose your 14-day right of withdrawal');
            expect(body).toContain('€4.50');
            expect(body).toContain('Includes VAT 25.5');
            expect(body).not.toContain('Delivery address');
        }
    });

    test('the confirmation of prints shows the address, shipping and the right of withdrawal', () => {
        const email = orderConfirmationEmail(
            input(
                {
                    subtotalCents: 2580,
                    shippingCents: 490,
                    parcelSize: 'M',
                    totalCents: 3070,
                    taxCents: 624,
                    shippingAddress: address,
                    immediateDeliveryConsentAt: null,
                },
                [printItem],
            ),
            { siteUrl: SITE },
        );

        expect(email.subject).toBe('Your Pesoprint order 0000ABCD');
        expect(email.text).toContain('Vase × 2: €25.80');
        expect(email.text).toContain('Print: PLA, Black');
        expect(email.text).toContain('Shipping (medium parcel): €4.90');
        expect(email.text).toContain('Total: €30.70');
        expect(email.text).toContain('Mannerheimintie 1\n00100 Helsinki\nFinland');
        expect(email.text).toContain('withdraw from the purchase of the prints within 14 days of receiving them');
        expect(email.text).not.toContain('/library');
        expect(email.text).not.toContain('lose your 14-day right');
    });

    test('the shipped email has the carrier and tracking number, and lists only the prints', () => {
        const email = orderShippedEmail(
            input({ parcelSize: 'M', shippingAddress: address, carrier: 'Posti', trackingNumber: 'JJFI123' }, [
                fileItem,
                printItem,
            ]),
            { siteUrl: SITE },
        );

        expect(email.subject).toBe('Your Pesoprint order 0000ABCD has shipped');
        expect(email.text).toContain('Carrier: Posti\nTracking number: JJFI123');
        expect(email.text).toContain('Vase × 2');
        expect(email.text).not.toContain('Cable hook');
        expect(email.html).toContain('JJFI123');
    });

    test('text from buyers and models is escaped in the HTML', () => {
        const email = orderShippedEmail(
            input(
                {
                    parcelSize: 'S',
                    shippingAddress: { ...address, name: '<b>Maija</b> & co' },
                    carrier: 'Posti',
                    trackingNumber: '"><script>x</script>',
                },
                [{ ...printItem, titleSnapshot: '<img src=x onerror=alert(1)>' }],
            ),
            { siteUrl: SITE },
        );

        expect(email.html).not.toContain('<script>');
        expect(email.html).not.toContain('<img');
        expect(email.html).not.toContain('<b>Maija');
        expect(email.html).toContain('&lt;b&gt;Maija&lt;/b&gt; &amp; co');
    });
});

/** Records what was sent; `failNext` makes the next sends throw, like Resend being down. */
function createFakeMailer() {
    const sent: (EmailMessage & { idempotencyKey: string })[] = [];
    const tries: string[] = [];
    let failures = 0;
    const mailer: Mailer & { sent: typeof sent; tries: typeof tries; failNext(count?: number): void } = {
        sent,
        tries,
        failNext: (count = 1) => {
            failures = count;
        },
        async send(message, { idempotencyKey }) {
            tries.push(idempotencyKey);
            if (failures > 0) {
                failures--;
                throw new Error('Resend is down');
            }
            sent.push({ ...message, idempotencyKey });
            return { id: `email_${sent.length}` };
        },
    };
    return mailer;
}

const url = process.env.TEST_DATABASE_URL;

// Runs against a real Postgres. Start it with `vp run db:up` (local) — CI provides one as a service.
describe.skipIf(!url)('order emails (integration)', () => {
    const { db, pool } = createDatabase(url ?? '');
    const BUYER_ID = 'user_email_buyer';
    const CREATOR_ID = 'user_email_creator';
    let now: Date;
    let mailer: ReturnType<typeof createFakeMailer>;
    let productId: string;
    let materialId: string;

    const emailsService = (withMailer: Mailer | null = mailer) =>
        createOrderEmailsService(db, withMailer, { siteUrl: SITE, now: () => now });

    async function reset() {
        await db.delete(orders);
        await db.delete(products);
        await db.delete(materials);
        await db.delete(categories).where(sql`${categories.parentId} IS NOT NULL`);
        await db.delete(categories);
    }

    /** A paid order: two PLA prints of the vase in a medium parcel, unless told otherwise. */
    async function order(overrides: Partial<NewOrder> = {}) {
        const [row] = await db
            .insert(orders)
            .values({
                userId: BUYER_ID,
                email: 'buyer@example.com',
                status: 'paid',
                subtotalCents: 2580,
                shippingCents: 490,
                parcelSize: 'M',
                taxCents: 624,
                totalCents: 3070,
                vatCountry: 'FI',
                vatRateBp: 2550,
                paidAt: new Date('2026-11-17T10:00:00Z'),
                shippingAddress: address,
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
            printSnapshot: printItem.printSnapshot,
        });
        return row!;
    }

    const emailsOf = (orderId: string) => db.select().from(orderEmails).where(eq(orderEmails.orderId, orderId));

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
        mailer = createFakeMailer();
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

    describe('when an order is paid', () => {
        /** Stripe, as far as `syncCheckout` needs it: every session is paid, for the order's total. */
        function paidPayments(orderId: string, totalCents: number): Payments {
            const state: CheckoutState = {
                id: 'cs_test_email',
                orderId,
                status: 'complete',
                paid: true,
                failed: false,
                paymentStatus: 'paid',
                amountTotalCents: totalCents,
                currency: 'eur',
                paymentIntentId: 'pi_test_email',
                paymentMethod: 'card',
                shippingAddress: address,
            };
            return {
                createCheckout: () => Promise.reject(new Error('not used')),
                refund: () => Promise.reject(new Error('not used')),
                getRefundedCents: () => Promise.reject(new Error('not used')),
                getCheckout: async () => state,
                verifyWebhook: null,
            };
        }

        test('queues one confirmation, however often Stripe reports the payment, and sends it once', async () => {
            const pending = await order({ status: 'pending', paidAt: null, stripeCheckoutSessionId: 'cs_test_email' });
            const emails = emailsService();
            const queued: string[] = [];
            const service = createOrdersService(db, {} as CartService, paidPayments(pending.id, pending.totalCents), {
                siteUrl: SITE,
                now: () => now,
                onEmailQueued: (orderId) => queued.push(orderId),
            });

            // The webhook, a retried webhook and the return page, all at once.
            await Promise.all([
                service.syncCheckout('cs_test_email'),
                service.syncCheckout('cs_test_email'),
                service.syncCheckout('cs_test_email'),
            ]);
            expect(queued).toEqual([pending.id]);
            await Promise.all([emails.deliver(pending.id), emails.deliver(pending.id), emails.deliver()]);

            expect(await emailsOf(pending.id)).toEqual([
                expect.objectContaining({
                    kind: 'order_confirmation',
                    attempts: 1,
                    sentAt: now,
                    providerId: 'email_1',
                }),
            ]);
            expect(mailer.sent).toHaveLength(1);
            expect(mailer.sent[0]).toMatchObject({
                to: 'buyer@example.com',
                subject: `Your Pesoprint order ${orderReference(pending.id)}`,
            });
            expect(mailer.sent[0]!.text).toContain('Mannerheimintie 1');
        });

        test('a failed send leaves the order paid, and is retried later with the same idempotency key', async () => {
            const pending = await order({ status: 'pending', paidAt: null, stripeCheckoutSessionId: 'cs_test_email' });
            const emails = emailsService();
            const deliveries: Promise<number>[] = [];
            const service = createOrdersService(db, {} as CartService, paidPayments(pending.id, pending.totalCents), {
                siteUrl: SITE,
                now: () => now,
                // As in production: sent right away, in the background.
                onEmailQueued: (orderId) => void deliveries.push(emails.deliver(orderId)),
            });

            mailer.failNext();
            await service.syncCheckout('cs_test_email');
            expect(await Promise.all(deliveries)).toEqual([0]);

            const [paid] = await db.select().from(orders).where(eq(orders.id, pending.id));
            expect(paid!.status).toBe('paid');
            const [failed] = await emailsOf(pending.id);
            expect(failed).toMatchObject({ attempts: 1, sentAt: null, lastError: 'Resend is down' });

            // Too soon: the failed try still blocks it.
            now = new Date(now.getTime() + RETRY_AFTER_MS - 1000);
            expect(await emails.deliver()).toBe(0);

            now = new Date(now.getTime() + 2000);
            expect(await emails.deliver()).toBe(1);
            const [sent] = await emailsOf(pending.id);
            expect(sent).toMatchObject({ attempts: 2, sentAt: now, lastError: null });
            expect(mailer.tries).toEqual([`order-email/${failed!.id}`, `order-email/${failed!.id}`]);
        });
    });

    describe('when prints ship', () => {
        test('marking an order shipped sends the tracking number once; correcting it sends nothing more', async () => {
            const paid = await order();
            const emails = emailsService();
            const queued: string[] = [];
            const admin = createAdminOrdersService(db, { now: () => now, onEmailQueued: (id) => queued.push(id) });

            await admin.setStatus(paid.id, { status: 'printing' });
            await admin.setStatus(paid.id, { status: 'shipped', carrier: 'Posti', trackingNumber: 'JJFI1' });
            await emails.deliver(paid.id);
            await admin.setStatus(paid.id, { status: 'shipped', carrier: 'Posti', trackingNumber: 'JJFI2' });
            await admin.setStatus(paid.id, { status: 'delivered' });
            await emails.deliver();

            expect(queued).toEqual([paid.id]);
            expect(mailer.sent.map((email) => email.subject)).toEqual([
                `Your Pesoprint order ${orderReference(paid.id)} has shipped`,
            ]);
            expect(mailer.sent[0]!.text).toContain('Tracking number: JJFI1');
        });
    });

    describe('the outbox', () => {
        test('without a mailer, emails wait, and go once one is set up', async () => {
            const paid = await order();
            await db.insert(orderEmails).values({ orderId: paid.id, kind: 'order_confirmation' });

            expect(await emailsService(null).deliver()).toBe(0);
            expect(await emailsOf(paid.id)).toEqual([expect.objectContaining({ attempts: 0, sentAt: null })]);

            expect(await emailsService().deliver()).toBe(1);
            expect(mailer.sent).toHaveLength(1);
        });

        test(`gives up after ${MAX_ATTEMPTS} tries`, async () => {
            const paid = await order();
            await db.insert(orderEmails).values({ orderId: paid.id, kind: 'order_confirmation' });
            const emails = emailsService();

            mailer.failNext(MAX_ATTEMPTS + 1);
            for (let i = 0; i < MAX_ATTEMPTS + 2; i++) {
                await emails.deliver();
                now = new Date(now.getTime() + RETRY_AFTER_MS + 1000);
            }

            expect(mailer.tries).toHaveLength(MAX_ATTEMPTS);
            expect(await emailsOf(paid.id)).toEqual([
                expect.objectContaining({ attempts: MAX_ATTEMPTS, sentAt: null, lastError: 'Resend is down' }),
            ]);
        });

        test('an email is queued at most once per order and kind', async () => {
            const paid = await order();
            await db.insert(orderEmails).values({ orderId: paid.id, kind: 'order_shipped' });
            await expect(
                db.insert(orderEmails).values({ orderId: paid.id, kind: 'order_shipped' }),
            ).rejects.toMatchObject({ cause: { constraint: 'order_emails_order_id_kind_unique' } });
        });
    });
});
