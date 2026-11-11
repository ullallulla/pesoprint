import { createDatabase } from './db/client.ts';
import { seedDatabase } from './db/seed.ts';
import { loadEnv } from './env.ts';

const env = loadEnv();

if (env.NODE_ENV === 'production') {
    console.error('Refusing to seed: NODE_ENV is production. The seed data is placeholder content.');
    process.exit(1);
}

const { db, pool } = createDatabase(env.DATABASE_URL);

try {
    const result = await seedDatabase(db);
    console.log(
        `Seeded ${result.categories} categories, ${result.products} products, ${result.images} images and ${result.files} files.`,
    );
} catch (error) {
    console.error('Seeding failed:', error);
    process.exitCode = 1;
} finally {
    await pool.end();
}
