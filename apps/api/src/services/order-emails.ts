import { and, asc, eq, isNull, lt, or, sql } from 'drizzle-orm';

import type { Database, Transaction } from '../db/client.ts';
import { orderEmails, orderItems, orders, type OrderEmailKind } from '../db/schema.ts';
import {
    orderConfirmationEmail,
    orderRefundedEmail,
    orderShippedEmail,
    type OrderEmailOptions,
} from '../emails/order-emails.ts';
import type { Mailer } from '../integrations/email.ts';

/** How long a try blocks the next one: a sender that crashed mid-send, or a failed send, is retried after this. */
export const RETRY_AFTER_MS = 10 * 60_000;
/** Tries before an email is given up on: about two hours of retries at {@link RETRY_AFTER_MS}. */
export const MAX_ATTEMPTS = 12;
/** At most this many emails per run, so one run never takes long. The rest wait for the next. */
const BATCH_SIZE = 25;

export interface OrderEmailsService {
    /**
     * Sends the queued emails that are due: those of one order, or of every order. Never throws: a failure is
     * recorded on the email and retried by a later run. Returns how many were sent.
     */
    deliver(orderId?: string): Promise<number>;
}

export interface OrderEmailsOptions extends OrderEmailOptions {
    now?: () => Date;
}

/**
 * Queues an email inside the transaction that changes the order, so it exists exactly when the change does.
 * An order gets each kind at most once: queuing it again changes nothing.
 */
export async function queueOrderEmail(tx: Database | Transaction, orderId: string, kind: OrderEmailKind) {
    await tx.insert(orderEmails).values({ orderId, kind }).onConflictDoNothing();
}

/** Not sent, and not tried in the last {@link RETRY_AFTER_MS}. */
function due(at: Date) {
    return and(
        isNull(orderEmails.sentAt),
        or(isNull(orderEmails.claimedAt), lt(orderEmails.claimedAt, new Date(at.getTime() - RETRY_AFTER_MS))),
    );
}

const TEMPLATES = {
    order_confirmation: orderConfirmationEmail,
    order_shipped: orderShippedEmail,
    order_refunded: orderRefundedEmail,
} as const;

/** `mailer` `null`: nothing is sent, and queued emails wait until a mailer is configured. */
export function createOrderEmailsService(
    db: Database,
    mailer: Mailer | null,
    { now = () => new Date(), ...templateOptions }: OrderEmailsOptions,
): OrderEmailsService {
    async function sendOne(email: { id: string; orderId: string; kind: OrderEmailKind }): Promise<boolean> {
        const at = now();
        // Claim it, so a second run at the same time (a webhook and the periodic run) leaves it alone.
        const [claimed] = await db
            .update(orderEmails)
            .set({ claimedAt: at, attempts: sql`${orderEmails.attempts} + 1` })
            .where(and(eq(orderEmails.id, email.id), due(at)))
            .returning({ attempts: orderEmails.attempts });
        if (!claimed) return false;

        try {
            const [order] = await db.select().from(orders).where(eq(orders.id, email.orderId));
            if (!order) throw new Error('The order no longer exists.');
            const items = await db
                .select()
                .from(orderItems)
                .where(eq(orderItems.orderId, order.id))
                .orderBy(asc(orderItems.id));
            const message = TEMPLATES[email.kind]({ order, items }, templateOptions);
            // The same key on every try: the provider drops a repeat of an email it already sent.
            const { id } = await mailer!.send(
                { to: order.email, ...message },
                { idempotencyKey: `order-email/${email.id}` },
            );
            await db
                .update(orderEmails)
                .set({ sentAt: now(), providerId: id, lastError: null })
                .where(eq(orderEmails.id, email.id));
            return true;
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            await db
                .update(orderEmails)
                .set({ lastError: reason.slice(0, 1000) })
                .where(eq(orderEmails.id, email.id));
            const outcome =
                claimed.attempts >= MAX_ATTEMPTS
                    ? `Giving up after ${claimed.attempts} tries; send it by hand.`
                    : `Will retry (try ${claimed.attempts} of ${MAX_ATTEMPTS}).`;
            console.error(`Sending the ${email.kind} email of order ${email.orderId} failed: ${reason}. ${outcome}`);
            return false;
        }
    }

    return {
        async deliver(orderId) {
            if (!mailer) return 0;
            let sent = 0;
            try {
                const queued = await db
                    .select({ id: orderEmails.id, orderId: orderEmails.orderId, kind: orderEmails.kind })
                    .from(orderEmails)
                    .where(
                        and(
                            due(now()),
                            lt(orderEmails.attempts, MAX_ATTEMPTS),
                            orderId === undefined ? undefined : eq(orderEmails.orderId, orderId),
                        ),
                    )
                    .orderBy(asc(orderEmails.createdAt))
                    .limit(BATCH_SIZE);
                for (const email of queued) {
                    if (await sendOne(email)) sent++;
                }
            } catch (error) {
                // The database is down: the emails stay queued for the next run.
                console.error('Sending order emails failed:', error);
            }
            return sent;
        },
    };
}
