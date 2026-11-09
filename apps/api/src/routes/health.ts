import { healthResponseSchema } from '@app/shared';
import { createRoute } from '@hono/zod-openapi';

import { createRouter } from '../lib/router.ts';

export interface HealthDeps {
    checkDatabase: () => Promise<boolean>;
    version: string;
    startedAt: Date;
}

const healthRoute = createRoute({
    method: 'get',
    path: '/health',
    tags: ['System'],
    summary: 'Service health',
    description: 'Reports whether the API and its database are reachable. Used by uptime checks and containers.',
    responses: {
        200: {
            description: 'The API and the database are up.',
            content: { 'application/json': { schema: healthResponseSchema } },
        },
        503: {
            description: 'The API is running but the database is unreachable.',
            content: { 'application/json': { schema: healthResponseSchema } },
        },
    },
});

export function healthRoutes(deps: HealthDeps) {
    return createRouter().openapi(healthRoute, async (c) => {
        const databaseUp = await deps.checkDatabase();
        const body = {
            status: databaseUp ? ('ok' as const) : ('degraded' as const),
            database: databaseUp ? ('up' as const) : ('down' as const),
            version: deps.version,
            uptimeSeconds: Math.floor((Date.now() - deps.startedAt.getTime()) / 1000),
        };
        return databaseUp ? c.json(body, 200) : c.json(body, 503);
    });
}
