import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { createDatabase } from './db/client.ts';
import { loadSeedAssets } from './db/seed-assets.ts';
import { seedDatabase } from './db/seed.ts';
import { loadEnv } from './env.ts';
import { createStorageFromEnv } from './integrations/s3.ts';
import { describeDatabaseUrl, isLocalDatabaseUrl } from './lib/database-url.ts';

/**
 * `vp run db:seed` fills the database from apps/api/.env with the sample catalogue.
 *
 * Options:
 *   --env <file>       use these settings instead of apps/api/.env, e.g. `--env .env.staging`
 *   --allow-remote     needed for any database that isn't on this computer (staging)
 */
const { values: options } = parseArgs({
    options: {
        // Not `--env-file`: Node takes that flag for itself before the script sees it.
        env: { type: 'string' },
        'allow-remote': { type: 'boolean', default: false },
    },
});

const env = loadEnv(process.env, {
    envFile: options.env === undefined ? undefined : resolve(options.env),
});

if (env.NODE_ENV === 'production') {
    console.error('Refusing to seed: NODE_ENV is production. The seed data is placeholder content.');
    process.exit(1);
}

const target = describeDatabaseUrl(env.DATABASE_URL);
if (!isLocalDatabaseUrl(env.DATABASE_URL)) {
    if (!options['allow-remote']) {
        console.error(
            `Refusing to seed ${target}: it isn't a database on this computer. Seeding replaces the sample ` +
                'products there and uploads files to its storage. If that is what you want, run again with --allow-remote.',
        );
        process.exit(1);
    }
    console.log(`Seeding the remote database ${target}.`);
}

const { db, pool } = createDatabase(env.DATABASE_URL);
const storage = createStorageFromEnv(env);

try {
    const assets = await loadSeedAssets(fileURLToPath(new URL('../seed-assets', import.meta.url)));
    if (assets.length > 0 && !storage) {
        console.warn(
            `Found ${assets.length} models in seed-assets/, but S3_* storage isn't configured: their files won't be uploaded.`,
        );
    }

    const result = await seedDatabase(db, { assets, storage });
    console.log(
        `Seeded ${result.categories} categories, ${result.products} products (${assets.length} from seed-assets/), ${result.images} images and ${result.files} files.`,
    );
    if (storage) {
        console.log(`Uploaded ${result.uploaded} new or changed asset files to storage.`);
    }
} catch (error) {
    console.error('Seeding failed:', error);
    process.exitCode = 1;
} finally {
    await pool.end();
}
