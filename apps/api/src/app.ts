import { swaggerUI } from '@hono/swagger-ui';
import { HTTPException } from 'hono/http-exception';
import { logger } from 'hono/logger';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';

import { errorCodeForStatus, sendError } from './lib/errors.ts';
import { createRouter } from './lib/router.ts';
import { adminRoutes, type AdminDeps } from './routes/admin.ts';
import { healthRoutes, type HealthDeps } from './routes/health.ts';
import { meRoutes } from './routes/me.ts';
import { webhookRoutes, type WebhookDeps } from './routes/webhooks.ts';

export interface AppOptions extends HealthDeps, AdminDeps, WebhookDeps {
    logRequests: boolean;
}

/**
 * Builds the Hono app without starting a server, so tests can call `app.request()` directly.
 * External dependencies (database, token verification, clock, version) are passed in instead of imported.
 */
export function createApp(options: AppOptions) {
    const app = createRouter();

    app.use(requestId());
    app.use(secureHeaders());
    if (options.logRequests) {
        app.use(logger());
    }

    app.route('/api', healthRoutes(options));
    app.route('/api', meRoutes(options));
    app.route('/api', adminRoutes(options));
    app.route('/api', webhookRoutes(options));

    // OpenAPI document + interactive docs
    app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Clerk session token (in the web app: `await getToken()`).',
    });
    app.doc31('/api/openapi.json', {
        openapi: '3.1.0',
        info: {
            title: 'Pesoprint API',
            version: options.version,
            description: 'Backend for the Pesoprint 3D-printing shop.',
        },
    });
    app.get('/api/docs', swaggerUI({ url: '/api/openapi.json' }));

    app.notFound((c) => sendError(c, 404, 'not_found', `No route for ${c.req.method} ${c.req.path}`));

    app.onError((error, c) => {
        if (error instanceof HTTPException) {
            return sendError(c, error.status, errorCodeForStatus(error.status), error.message);
        }
        console.error(`[${c.get('requestId')}] Unhandled error:`, error);
        return sendError(c, 500, 'internal_error', 'Something went wrong.');
    });

    return app;
}

export type App = ReturnType<typeof createApp>;
