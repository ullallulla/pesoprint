import { adminOverviewSchema, apiErrorSchema } from '@app/shared';
import { createRoute } from '@hono/zod-openapi';

import type { VerifySessionToken } from '../lib/auth.ts';
import { createRouter } from '../lib/router.ts';
import { requireAdmin } from '../middleware/auth.ts';
import type { UsersService } from '../services/users.ts';

export interface AdminDeps {
    verifySessionToken: VerifySessionToken;
    users: UsersService;
}

export function adminRoutes(deps: AdminDeps) {
    const overviewRoute = createRoute({
        method: 'get',
        path: '/admin/overview',
        tags: ['Admin'],
        summary: 'Admin dashboard numbers',
        description: 'Admin only. Grows into the dashboard summary (orders, revenue, …) in later milestones.',
        security: [{ bearerAuth: [] }],
        middleware: [requireAdmin(deps.verifySessionToken)] as const,
        responses: {
            200: {
                description: 'Overview numbers.',
                content: { 'application/json': { schema: adminOverviewSchema } },
            },
            401: {
                description: 'Missing, invalid or expired session token.',
                content: { 'application/json': { schema: apiErrorSchema } },
            },
            403: {
                description: 'The caller is not an admin.',
                content: { 'application/json': { schema: apiErrorSchema } },
            },
        },
    });

    return createRouter().openapi(overviewRoute, async (c) => {
        return c.json({ userCount: await deps.users.count() }, 200);
    });
}
