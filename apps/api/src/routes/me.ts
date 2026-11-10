import { apiErrorSchema, meResponseSchema } from '@app/shared';
import { createRoute } from '@hono/zod-openapi';

import type { VerifySessionToken } from '../lib/auth.ts';
import { createRouter } from '../lib/router.ts';
import { requireUser } from '../middleware/auth.ts';

export function meRoutes(deps: { verifySessionToken: VerifySessionToken }) {
    const meRoute = createRoute({
        method: 'get',
        path: '/me',
        tags: ['Account'],
        summary: 'The signed-in user',
        description: 'Returns the caller identified by the Clerk session token.',
        security: [{ bearerAuth: [] }],
        middleware: [requireUser(deps.verifySessionToken)] as const,
        responses: {
            200: {
                description: 'The signed-in user.',
                content: { 'application/json': { schema: meResponseSchema } },
            },
            401: {
                description: 'Missing, invalid or expired session token.',
                content: { 'application/json': { schema: apiErrorSchema } },
            },
        },
    });

    return createRouter().openapi(meRoute, (c) => {
        const { userId, role } = c.get('auth');
        return c.json({ userId, role }, 200);
    });
}
