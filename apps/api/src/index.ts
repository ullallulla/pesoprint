import { verifyWebhook } from '@clerk/backend/webhooks';
import { serve } from '@hono/node-server';

import packageJson from '../package.json' with { type: 'json' };
import { createApp } from './app.ts';
import { createDatabase, pingDatabase } from './db/client.ts';
import { loadEnv } from './env.ts';
import { createClerkTokenVerifier } from './lib/auth.ts';
import { createCategoriesService } from './services/categories.ts';
import { createUsersService } from './services/users.ts';

const env = loadEnv();
const { db, pool } = createDatabase(env.DATABASE_URL);

const signingSecret = env.CLERK_WEBHOOK_SIGNING_SECRET;
if (!signingSecret) {
    console.warn('CLERK_WEBHOOK_SIGNING_SECRET is not set: POST /api/webhooks/clerk will answer 503.');
}

const app = createApp({
    checkDatabase: () => pingDatabase(db),
    verifySessionToken: createClerkTokenVerifier({
        secretKey: env.CLERK_SECRET_KEY,
        authorizedParties: env.WEB_ORIGINS,
    }),
    verifyClerkWebhook: signingSecret ? (request) => verifyWebhook(request, { signingSecret }) : null,
    users: createUsersService(db),
    categories: createCategoriesService(db),
    version: packageJson.version,
    startedAt: new Date(),
    logRequests: env.LOG_REQUESTS,
});

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`Pesoprint API listening on http://localhost:${info.port} (docs: /api/docs)`);
});

function shutdown(signal: string) {
    console.log(`${signal} received, shutting down...`);
    server.close(() => {
        void pool.end().then(() => process.exit(0));
    });
    // Force exit if connections don't close in time.
    setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
