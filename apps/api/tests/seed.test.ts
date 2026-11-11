import { fileURLToPath } from 'node:url';

import { publishProblems } from '@app/shared';
import { and, count, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vite-plus/test';

import { createDatabase, runMigrations } from '../src/db/client.ts';
import { categories, productFiles, productImages, products, users } from '../src/db/schema.ts';
import { SEED_CREATOR, seedDatabase } from '../src/db/seed.ts';

const url = process.env.TEST_DATABASE_URL;

// Runs against a real Postgres. Start it with `vp run db:up` (local) — CI provides one as a service.
describe.skipIf(!url)('seedDatabase (integration)', () => {
    const { db, pool } = createDatabase(url ?? '');
    const OWNER_ID = 'user_seed_test_owner';

    async function resetCatalogue() {
        await db.delete(products);
        await db.delete(categories).where(sql`${categories.parentId} IS NOT NULL`);
        await db.delete(categories);
        await db.delete(users).where(sql`${users.id} IN (${SEED_CREATOR.id}, ${OWNER_ID})`);
    }

    beforeAll(async () => {
        await runMigrations(db, fileURLToPath(new URL('../drizzle', import.meta.url)));
        await resetCatalogue();
    });

    afterAll(async () => {
        await resetCatalogue();
        await pool.end();
    });

    test('seeds a catalogue, and seeding again gives the same result', async () => {
        const first = await seedDatabase(db);
        expect(first.products).toBeGreaterThanOrEqual(15);

        const second = await seedDatabase(db);
        expect(second).toEqual(first);
        const [total] = await db.select({ value: count() }).from(products);
        expect(total?.value).toBe(first.products);
    });

    test('every published sample product passes the publishing rules the API enforces', async () => {
        const published = await db.select().from(products).where(eq(products.status, 'published'));
        expect(published.length).toBeGreaterThan(0);

        for (const product of published) {
            const [images] = await db
                .select({ value: count() })
                .from(productImages)
                .where(eq(productImages.productId, product.id));
            const [downloads] = await db
                .select({ value: count() })
                .from(productFiles)
                .where(and(eq(productFiles.productId, product.id), eq(productFiles.kind, 'download')));

            expect({
                slug: product.slug,
                problems: publishProblems({
                    ...product,
                    imageCount: images?.value ?? 0,
                    downloadFileCount: downloads?.value ?? 0,
                }),
            }).toEqual({ slug: product.slug, problems: [] });
        }
    });

    test('covers every way a model can be offered', async () => {
        const rows = await db.select().from(products).where(eq(products.status, 'published'));
        const offers = new Set(
            rows.map(
                (p) =>
                    `${p.digitalPriceCents === null ? 'none' : p.digitalPriceCents === 0 ? 'free' : 'paid'}+${p.printBasePriceCents === null ? 'no-print' : 'print'}`,
            ),
        );
        expect([...offers].sort()).toEqual([
            'free+no-print',
            'free+print',
            'none+print',
            'paid+no-print',
            'paid+print',
        ]);
        expect(rows.filter((p) => p.featuredAt !== null).length).toBeGreaterThan(0);
    });

    test("leaves your own products alone, even in seed categories, and skips seed slugs you've used", async () => {
        // Start from categories only, so this user can take a seed slug before the seed claims it.
        await db.delete(products).where(eq(products.creatorId, SEED_CREATOR.id));
        await db.insert(users).values({ id: OWNER_ID, email: 'owner@example.com', role: 'admin' });
        const [toys] = await db.select().from(categories).where(eq(categories.slug, 'print-in-place'));
        await db.insert(products).values([
            { slug: 'my-own-model', title: 'Mine', creatorId: OWNER_ID, categoryId: toys!.id },
            { slug: 'articulated-dragon', title: 'My dragon', creatorId: OWNER_ID },
        ]);

        const result = await seedDatabase(db);

        const mine = await db.select().from(products).where(eq(products.creatorId, OWNER_ID));
        expect(mine.map((p) => p.slug).sort()).toEqual(['articulated-dragon', 'my-own-model']);
        expect(mine.find((p) => p.slug === 'articulated-dragon')?.title).toBe('My dragon');

        const [seeded] = await db
            .select({ value: count() })
            .from(products)
            .where(eq(products.creatorId, SEED_CREATOR.id));
        expect(seeded?.value).toBe(result.products);
    });
});
