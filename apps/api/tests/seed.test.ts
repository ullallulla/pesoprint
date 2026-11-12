import { fileURLToPath } from 'node:url';

import { publishProblems } from '@app/shared';
import { and, count, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vite-plus/test';

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDatabase, runMigrations } from '../src/db/client.ts';
import { loadSeedAssets } from '../src/db/seed-assets.ts';
import { categories, productFiles, productImages, products, users } from '../src/db/schema.ts';
import { SEED_CREATOR, seedDatabase } from '../src/db/seed.ts';
import { createFakeStorage } from './helpers.ts';
import { TINY_PNG, tinyStl, validSource, writeAsset } from './seed-fixtures.ts';

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

    describe('with real models from seed-assets/', () => {
        let dir: string;

        beforeAll(async () => {
            dir = await mkdtemp(join(tmpdir(), 'seed-assets-'));
            await writeAsset(
                dir,
                'real-cable-clip',
                { ...validSource, printBasePriceCents: 990, featured: true, size: [20, 15, 12] },
                {
                    'render-1.png': TINY_PNG,
                    'cable-clip.stl': tinyStl(),
                },
            );
        });

        afterAll(async () => {
            await rm(dir, { recursive: true, force: true });
        });

        test('publishes them first, uploads their files once, and leads the featured list', async () => {
            const storage = createFakeStorage();
            const assets = await loadSeedAssets(dir);

            const first = await seedDatabase(db, { assets, storage });
            expect(storage.puts).toEqual(
                expect.arrayContaining([
                    'private:seed/products/real-cable-clip/cable-clip.stl',
                    'public:seed/products/real-cable-clip/render-1.png',
                    // The placeholder products get the shared placeholder image.
                    'public:seed/products/articulated-dragon/image-1.webp',
                ]),
            );
            expect(first.uploaded).toBe(storage.puts.length);
            const uploadsAfterFirstRun = storage.puts.length;

            const [product] = await db.select().from(products).where(eq(products.slug, 'real-cable-clip'));
            expect(product).toMatchObject({
                status: 'published',
                title: 'Cable Clip',
                sizeXMm: 20,
                printBasePriceCents: 990,
            });

            const [newest] = await db
                .select({ slug: products.slug })
                .from(products)
                .orderBy(sql`${products.publishedAt} DESC NULLS LAST`)
                .limit(1);
            expect(newest?.slug).toBe('real-cable-clip');
            const [topFeatured] = await db
                .select({ slug: products.slug })
                .from(products)
                .orderBy(sql`${products.featuredAt} DESC NULLS LAST`)
                .limit(1);
            expect(topFeatured?.slug).toBe('real-cable-clip');

            const images = await db.select().from(productImages).where(eq(productImages.productId, product!.id));
            expect(images).toEqual([
                expect.objectContaining({
                    storageKey: 'seed/products/real-cable-clip/render-1.png',
                    alt: '3D render of the Cable Clip',
                    width: 1,
                    height: 1,
                }),
            ]);

            // Unchanged files are not uploaded again.
            const second = await seedDatabase(db, { assets, storage });
            expect(second.uploaded).toBe(0);
            expect(storage.puts).toHaveLength(uploadsAfterFirstRun);
        });

        test('refuses, before writing anything, a model that could not be published', async () => {
            const assets = await loadSeedAssets(dir);
            const broken = assets.map((asset) => ({
                ...asset,
                source: { ...asset.source, category: 'no-such-category' },
            }));
            await expect(seedDatabase(db, { assets: broken })).rejects.toThrow(/unknown category "no-such-category"/);

            const noImages = assets.map((asset) => ({ ...asset, images: [] }));
            await expect(seedDatabase(db, { assets: noImages })).rejects.toThrow(
                /can't be published: Add at least one image/,
            );
        });
    });
});
