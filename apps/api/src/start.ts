import { fileURLToPath } from 'node:url';

import { createDatabase, runMigrations } from './db/client.ts';
import { loadEnv } from './env.ts';

/**
 * Production entry for hosts that start a container with one command (e.g. Render's free plan, which
 * has no pre-deploy step): applies pending migrations, then starts the API.
 *
 * If a migration fails the process exits with an error before serving anything, so the host keeps
 * running the previous version. Only run one instance this way: two starting at once would both migrate.
 */
const env = loadEnv();
const { db, pool } = createDatabase(env.DATABASE_URL);
try {
    // src/start.ts and dist/start.mjs both sit one level below the package root.
    await runMigrations(db, fileURLToPath(new URL('../drizzle', import.meta.url)));
    console.log('Migrations applied.');
} finally {
    await pool.end();
}

await import('./index.ts');
