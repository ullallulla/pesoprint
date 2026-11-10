import { apiErrorSchema } from '@app/shared';
import type { WebhookEvent } from '@clerk/backend';
import { createRoute, z } from '@hono/zod-openapi';

import { userFromClerk } from '../lib/clerk-user.ts';
import { sendError } from '../lib/errors.ts';
import { createRouter } from '../lib/router.ts';
import type { UsersService } from '../services/users.ts';

/** Verifies the webhook signature and returns the event, or throws. `null` when no signing secret is configured. */
export type VerifyClerkWebhook = ((request: Request) => Promise<WebhookEvent>) | null;

export interface WebhookDeps {
    verifyClerkWebhook: VerifyClerkWebhook;
    users: UsersService;
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

export function webhookRoutes(deps: WebhookDeps) {
    return createRouter().openapi(clerkWebhookRoute, async (c) => {
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
