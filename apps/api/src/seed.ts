import { fileURLToPath } from 'node:url';

import { createDatabase } from './db/client.ts';
import { loadSeedAssets } from './db/seed-assets.ts';
import { seedDatabase } from './db/seed.ts';
import { loadEnv } from './env.ts';
import { createStorageFromEnv } from './integrations/s3.ts';

const env = loadEnv();

if (env.NODE_ENV === 'production') {
    console.error('Refusing to seed: NODE_ENV is production. The seed data is placeholder content.');
    process.exit(1);
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
