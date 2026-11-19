import { isPaidStatus } from '@app/shared';
import { and, eq, ne } from 'drizzle-orm';

import type { Database } from '../db/client.ts';
import { entitlements, orders, type Order } from '../db/schema.ts';
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
     * The one place an order changes because of a refund. Only moves forward, and only from the amount it read,
     * so the webhook and the admin's request arriving together apply it once.
     */
    async function applyRefunded(order: Order, refundedCents: number): Promise<void> {
        if (refundedCents === order.refundedCents) return;
        if (refundedCents < order.refundedCents) {
            // A pending refund that failed: the money is still ours, and the admin decides what to do.
            console.error(
                `Order ${order.id}: Stripe now reports ${refundedCents} cents refunded, less than the ${order.refundedCents} recorded. Check the payment in Stripe.`,
            );
            return;
        }
        const full = refundedCents >= order.totalCents;
        const refunded = await db.transaction(async (tx) => {
            const [row] = await tx
                .update(orders)
                .set({
                    refundedCents: Math.min(refundedCents, order.totalCents),
                    ...(full && { status: 'refunded' as const, refundedAt: now() }),
                })
                .where(
                    and(
                        eq(orders.id, order.id),
                        eq(orders.refundedCents, order.refundedCents),
                        ne(orders.status, 'refunded'),
                    ),
                )
                .returning({ id: orders.id });
            if (!row || !full) return false;
            // A refunded file is no longer the buyer's.
            await tx.delete(entitlements).where(eq(entitlements.orderId, order.id));
            await queueOrderEmail(tx, order.id, 'order_refunded');
            return true;
        });
        if (refunded) onEmailQueued?.(order.id);
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
            await applyRefunded(order, await payments.getRefundedCents(order.stripePaymentIntentId));
        },

        async syncRefunds(paymentIntentId) {
            if (!payments) throw paymentsUnavailable();
            const [order] = await db.select().from(orders).where(eq(orders.stripePaymentIntentId, paymentIntentId));
            if (!order) {
                // Another environment sharing the Stripe account (e.g. local and staging in test mode).
                console.warn(`Stripe refund webhook for payment ${paymentIntentId}, which no order here has. Ignored.`);
                return;
            }
            if (order.status === 'pending') {
                // The payment's own webhook hasn't arrived yet. Failing makes Stripe deliver this one again later.
                throw new Error(`Order ${order.id} was refunded before it was recorded as paid. Retry later.`);
            }
            if (order.status === 'cancelled') return;
            await applyRefunded(order, await payments.getRefundedCents(paymentIntentId));
        },
    };
}
