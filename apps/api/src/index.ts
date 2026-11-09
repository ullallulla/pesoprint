import { serve } from '@hono/node-server';

import packageJson from '../package.json' with { type: 'json' };
import { createApp } from './app.ts';
import { createDatabase, pingDatabase } from './db/client.ts';
import { loadEnv } from './env.ts';

const env = loadEnv();
const { db, pool } = createDatabase(env.DATABASE_URL);

const app = createApp({
    checkDatabase: () => pingDatabase(db),
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
