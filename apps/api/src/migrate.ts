import { fileURLToPath } from 'node:url';

import { createDatabase, runMigrations } from './db/client.ts';
import { loadEnv } from './env.ts';

// src/migrate.ts and dist/migrate.mjs both sit one level below the package root.
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

const env = loadEnv();
const { db, pool } = createDatabase(env.DATABASE_URL);

try {
    await runMigrations(db, migrationsFolder);
    console.log('Migrations applied.');
} catch (error) {
    console.error('Migration failed:', error);
    process.exitCode = 1;
} finally {
    await pool.end();
}
