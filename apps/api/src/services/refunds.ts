import { isPaidStatus, PAID_ORDER_STATUSES } from '@app/shared';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';

import type { Database, Transaction } from '../db/client.ts';
import { entitlements, orderItems, orders, users, type Order } from '../db/schema.ts';
import { RefundError, type Payments } from '../integrations/stripe.ts';
import { AppError, conflict, notFound } from '../lib/errors.ts';
import { queueOrderEmail } from './order-emails.ts';

export interface RefundsService {
    /**
     * Refunds what's left of a paid order through Stripe, then records it: the order is `refunded`, the files it
     * bought leave the buyer's library, and the buyer gets an email. Refunding a refunded order changes nothing.
     * Refuses an order that isn't paid (409), and reports Stripe's refusal (502).
     */
    refund(orderId: string): Promise<void>;
    /**
     * Records what Stripe has refunded of a payment, whoever refunded it (the Stripe webhook calls this, so
     * refunds made in Stripe's dashboard count too). A partial refund is only recorded; a full one refunds the
     * order as {@link refund} does.
     */
    syncRefunds(paymentIntentId: string): Promise<void>;
}

export interface RefundsOptions {
    now?: () => Date;
    /** Called once an email was queued for an order (it's refunded), to send it right away. Mustn't throw. */
    onEmailQueued?: (orderId: string) => void;
}

const paymentsUnavailable = () => new AppError(503, 'internal_error', "Payments aren't set up on this server.");

export function createRefundsService(
    db: Database,
    payments: Payments | null,
    { now = () => new Date(), onEmailQueued }: RefundsOptions = {},
): RefundsService {
    /**
     * The one place an order changes because of a refund. Locks the order, then asks Stripe for the total refunded
     * so far: a webhook and the admin's request (or two webhooks) arriving together take turns, and each applies
     * Stripe's latest total, so none is lost and the order is refunded once.
     */
    async function applyRefunded(orderId: string, paymentIntentId: string, stripe: Payments): Promise<void> {
        const refunded = await db.transaction(async (tx) => {
            const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
            if (!order || order.status === 'refunded') return false;
            const { refundedCents } = await stripe.getRefunds(paymentIntentId);
            if (refundedCents === order.refundedCents) return false;
            if (refundedCents < order.refundedCents) {
                // A pending refund that failed: the money is still ours, and the admin decides what to do.
                console.error(
                    `Order ${order.id}: Stripe now reports ${refundedCents} cents refunded, less than the ${order.refundedCents} recorded. Check the payment in Stripe.`,
                );
                return false;
            }
            const full = refundedCents >= order.totalCents;
            await tx
                .update(orders)
                .set({
                    refundedCents: Math.min(refundedCents, order.totalCents),
                    ...(full && { status: 'refunded' as const, refundedAt: now() }),
                })
                .where(eq(orders.id, order.id));
            if (!full) return false;
            await revokeFiles(tx, order);
            await queueOrderEmail(tx, order.id, 'order_refunded');
            return true;
        });
        if (refunded) onEmailQueued?.(orderId);
    }

    /**
     * A refunded order's files are no longer the buyer's, unless another of their paid orders bought the same file
     * (e.g. two checkouts paid at once, one of them refunded): that order becomes the record instead.
     */
    async function revokeFiles(tx: Transaction, order: Order): Promise<void> {
        if (!order.userId) {
            await tx.delete(entitlements).where(eq(entitlements.orderId, order.id));
            return;
        }
        // The buyer's refunds take turns here, so two of their orders refunded at once can't each hand the files
        // to the other. Doesn't block their checkouts, which only take a key-share lock on the row.
        await tx.select({ id: users.id }).from(users).where(eq(users.id, order.userId)).for('no key update');
        const taken = await tx
            .delete(entitlements)
            .where(eq(entitlements.orderId, order.id))
            .returning({ productId: entitlements.productId });
        if (taken.length === 0) return;
        const stillPaid = await tx
            .selectDistinctOn([orderItems.productId], { productId: orderItems.productId, orderId: orders.id })
            .from(orderItems)
            .innerJoin(orders, eq(orders.id, orderItems.orderId))
            .where(
                and(
                    eq(orders.userId, order.userId),
                    ne(orders.id, order.id),
                    inArray(orders.status, [...PAID_ORDER_STATUSES]),
                    eq(orderItems.type, 'digital'),
                    inArray(
                        orderItems.productId,
                        taken.map((row) => row.productId),
                    ),
                ),
            )
            .orderBy(orderItems.productId, asc(orders.paidAt));
        if (stillPaid.length === 0) return;
        await tx
            .insert(entitlements)
            .values(stillPaid.map((row) => ({ userId: order.userId!, productId: row.productId, orderId: row.orderId })))
            .onConflictDoNothing();
    }

    return {
        async refund(orderId) {
            const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
            if (!order) throw notFound('No order with this id.');
            if (order.status === 'refunded') return;
            if (!isPaidStatus(order.status) || !order.stripePaymentIntentId) {
                throw conflict("This order wasn't paid, so there's nothing to refund.");
            }
            if (!payments) throw paymentsUnavailable();

            const remaining = order.totalCents - order.refundedCents;
            try {
                await payments.refund({
                    paymentIntentId: order.stripePaymentIntentId,
                    amountCents: remaining,
                    // The same request twice (a double click) is one refund. After a partial refund in Stripe's
                    // dashboard, the rest is a new request.
                    idempotencyKey: `refund-${order.id}-${order.refundedCents}`,
                });
            } catch (error) {
                if (error instanceof RefundError) {
                    throw new AppError(502, 'internal_error', `Stripe didn't make the refund: ${error.message}`);
                }
                console.error(`Refunding order ${order.id} failed:`, error);
                throw new AppError(502, 'internal_error', "Couldn't reach Stripe. Try again in a moment.");
            }
            await applyRefunded(order.id, order.stripePaymentIntentId, payments);
        },

        async syncRefunds(paymentIntentId) {
            if (!payments) throw paymentsUnavailable();
            let [order] = await db.select().from(orders).where(eq(orders.stripePaymentIntentId, paymentIntentId));
            if (!order) {
                // The payment is recorded on its order only once the order is paid, so a refund that arrives first
                // finds its order through the payment's metadata (set at checkout).
                const { orderId } = await payments.getRefunds(paymentIntentId);
                if (orderId && z.uuid().safeParse(orderId).success) {
                    [order] = await db.select().from(orders).where(eq(orders.id, orderId));
                }
            }
            if (!order || (order.stripePaymentIntentId && order.stripePaymentIntentId !== paymentIntentId)) {
                // Another environment sharing the Stripe account (e.g. local and staging in test mode).
                console.warn(`Stripe refund webhook for payment ${paymentIntentId}, which no order here has. Ignored.`);
                return;
            }
            if (order.status === 'pending') {
                // The payment's own webhook hasn't arrived yet. Failing makes Stripe deliver this one again later.
                throw new Error(`Order ${order.id} was refunded before it was recorded as paid. Retry later.`);
            }
            if (order.status === 'cancelled') return;
            await applyRefunded(order.id, paymentIntentId, payments);
        },
    };
}
