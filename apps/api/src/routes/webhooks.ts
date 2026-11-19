import { apiErrorSchema } from '@app/shared';
import type { WebhookEvent } from '@clerk/backend';
import { createRoute, z } from '@hono/zod-openapi';

import { WebhookSignatureError, type PaymentEvent, type Payments } from '../integrations/stripe.ts';
import { userFromClerk } from '../lib/clerk-user.ts';
import { sendError } from '../lib/errors.ts';
import { createRouter } from '../lib/router.ts';
import type { OrdersService } from '../services/orders.ts';
import type { RefundsService } from '../services/refunds.ts';
import type { UsersService } from '../services/users.ts';

/** Verifies the webhook signature and returns the event, or throws. `null` when no signing secret is configured. */
export type VerifyClerkWebhook = ((request: Request) => Promise<WebhookEvent>) | null;

export interface WebhookDeps {
    verifyClerkWebhook: VerifyClerkWebhook;
    users: UsersService;
    /** `null` when Stripe or its webhook signing secret isn't configured. */
    verifyStripeWebhook: Payments['verifyWebhook'];
    orders: OrdersService;
    refunds: RefundsService;
}

const receivedSchema = z.object({ received: z.literal(true) });

const clerkWebhookRoute = createRoute({
    method: 'post',
    path: '/webhooks/clerk',
    tags: ['Webhooks'],
    summary: 'Clerk user events',
    description:
        'Called by Clerk (signed with Standard Webhooks). Keeps the `users` table in sync on user.created, user.updated and user.deleted.',
    responses: {
        200: { description: 'Event processed.', content: { 'application/json': { schema: receivedSchema } } },
        400: { description: 'Invalid signature.', content: { 'application/json': { schema: apiErrorSchema } } },
        503: {
            description: 'Webhook signing secret not configured.',
            content: { 'application/json': { schema: apiErrorSchema } },
        },
    },
});

const stripeWebhookRoute = createRoute({
    method: 'post',
    path: '/webhooks/stripe',
    tags: ['Webhooks'],
    summary: 'Stripe payment events',
    description: [
        "Called by Stripe, signed with the endpoint's secret (`Stripe-Signature`). On",
        '`checkout.session.completed`, `.async_payment_succeeded`, `.async_payment_failed` and `.expired`, the',
        'order is updated from the session as Stripe reports it: paid (and the files granted) or cancelled. On',
        '`charge.refunded` and `charge.refund.updated`, the amount refunded is recorded, and an order refunded in',
        'full becomes `refunded` (and its files are taken back). Repeated deliveries change nothing. Other',
        'events are acknowledged and ignored.',
    ].join('\n'),
    responses: {
        200: { description: 'Event processed.', content: { 'application/json': { schema: receivedSchema } } },
        400: { description: 'Invalid signature.', content: { 'application/json': { schema: apiErrorSchema } } },
        503: {
            description: 'Stripe webhooks are not configured.',
            content: { 'application/json': { schema: apiErrorSchema } },
        },
    },
});

export function webhookRoutes(deps: WebhookDeps) {
    return createRouter()
        .openapi(stripeWebhookRoute, async (c) => {
            if (!deps.verifyStripeWebhook) {
                return sendError(c, 503, 'internal_error', 'Stripe webhooks are not configured on this server.');
            }
            const signature = c.req.header('stripe-signature');
            if (!signature) return sendError(c, 400, 'bad_request', 'Missing Stripe-Signature header.');

            let event: PaymentEvent | null;
            try {
                // The signature covers the exact bytes Stripe sent, so the body is read as text, not parsed.
                event = await deps.verifyStripeWebhook(await c.req.text(), signature);
            } catch (error) {
                if (error instanceof WebhookSignatureError) {
                    return sendError(c, 400, 'bad_request', 'Invalid webhook signature.');
                }
                throw error;
            }
            // A thrown error (database or Stripe down) becomes a 500, and Stripe retries the delivery.
            if (event?.kind === 'checkout') await deps.orders.syncCheckout(event.sessionId);
            if (event?.kind === 'refund') await deps.refunds.syncRefunds(event.paymentIntentId);
            return c.json({ received: true as const }, 200);
        })
        .openapi(clerkWebhookRoute, async (c) => {
            if (!deps.verifyClerkWebhook) {
                return sendError(c, 503, 'internal_error', 'Clerk webhooks are not configured on this server.');
            }

            let event: WebhookEvent;
            try {
                event = await deps.verifyClerkWebhook(c.req.raw);
            } catch {
                return sendError(c, 400, 'bad_request', 'Invalid webhook signature.');
            }

            switch (event.type) {
                case 'user.created':
                case 'user.updated': {
                    const user = userFromClerk(event.data);
                    if (user) {
                        await deps.users.upsert(user);
                    }
                    break;
                }
                case 'user.deleted':
                    if (event.data.id) {
                        await deps.users.remove(event.data.id);
                    }
                    break;
                default:
                    // Other event types are acknowledged so Clerk doesn't retry them.
                    break;
            }

            // A thrown error above (e.g. database down) becomes a 500, and Clerk retries the delivery.
            return c.json({ received: true as const }, 200);
        });
}
