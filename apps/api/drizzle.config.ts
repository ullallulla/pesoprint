import { existsSync } from 'node:fs';

import { defineConfig } from 'drizzle-kit';

// drizzle-kit runs from apps/api, so .env is in the working directory.
if (existsSync('.env')) {
    process.loadEnvFile('.env');
}

const url = process.env.DATABASE_URL;
if (!url) {
    throw new Error('DATABASE_URL is not set. Copy apps/api/.env.example to apps/api/.env.');
}

export default defineConfig({
    dialect: 'postgresql',
    schema: './src/db/schema.ts',
    out: './drizzle',
    dbCredentials: { url },
    strict: true,
    verbose: true,
});
