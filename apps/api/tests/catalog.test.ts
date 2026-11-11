import { fileURLToPath } from 'node:url';

import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vite-plus/test';

import { createDatabase, runMigrations } from '../src/db/client.ts';
import {
    categories,
    productFiles,
    productImages,
    products,
    users,
    type NewProduct,
    type NewProductFile,
} from '../src/db/schema.ts';

const url = process.env.TEST_DATABASE_URL;

const CHECK_VIOLATION = { cause: { code: '23514' } };
const UNIQUE_VIOLATION = { cause: { code: '23505' } };
// ON DELETE RESTRICT reports restrict_violation, not the generic foreign_key_violation (23503).
const RESTRICT_VIOLATION = { cause: { code: '23001' } };

const CREATOR_ID = 'user_catalog_creator';

// Runs against a real Postgres. Start it with `vp run db:up` (local) — CI provides one as a service.
describe.skipIf(!url)('catalogue schema (integration)', () => {
    const { db, pool } = createDatabase(url ?? '');
    let categoryId: string;

    /** RESTRICT is checked per row, so delete products and child categories before their parents. */
    async function resetCatalogue() {
        await db.delete(products); // cascades to images and files
        await db.delete(categories).where(sql`${categories.parentId} IS NOT NULL`);
        await db.delete(categories);
    }

    function product(overrides: Partial<NewProduct> = {}): NewProduct {
        return {
            slug: `model-${crypto.randomUUID()}`,
            creatorId: CREATOR_ID,
            title: 'Articulated Dragon',
            ...overrides,
        };
    }

    async function insertProduct(overrides: Partial<NewProduct> = {}) {
        const [row] = await db.insert(products).values(product(overrides)).returning();
        if (!row) throw new Error('insert returned no row');
        return row;
    }

    const published = (overrides: Partial<NewProduct> = {}): Partial<NewProduct> => ({
        status: 'published',
        publishedAt: new Date(),
        categoryId,
        digitalPriceCents: 0,
        license: 'cc_by',
        ...overrides,
    });

    function file(productId: string, overrides: Partial<NewProductFile> = {}): NewProductFile {
        return {
            productId,
            kind: 'download',
            format: 'stl',
            filename: 'dragon.stl',
            storageKey: `products/${productId}/files/${crypto.randomUUID()}.stl`,
            sizeBytes: 1024,
            ...overrides,
        };
    }

    beforeAll(async () => {
        await runMigrations(db, fileURLToPath(new URL('../drizzle', import.meta.url)));
        await resetCatalogue();
        await db.delete(users).where(eq(users.id, CREATOR_ID));
        await db.insert(users).values({ id: CREATOR_ID, email: 'creator@example.com', role: 'admin' });
    });

    beforeEach(async () => {
        await resetCatalogue();
        const [row] = await db.insert(categories).values({ slug: 'toys', name: 'Toys' }).returning();
        categoryId = row!.id;
    });

    afterAll(async () => {
        await resetCatalogue();
        await db.delete(users).where(eq(users.id, CREATOR_ID));
        await pool.end();
    });

    describe('categories', () => {
        test('generates a UUIDv7 id and supports a parent', async () => {
            const [child] = await db
                .insert(categories)
                .values({ slug: 'fidget-toys', name: 'Fidget toys', parentId: categoryId })
                .returning();
            expect(child?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
            expect(child?.parentId).toBe(categoryId);
        });

        test('rejects a malformed slug', async () => {
            await expect(db.insert(categories).values({ slug: 'Fidget Toys', name: 'x' })).rejects.toMatchObject(
                CHECK_VIOLATION,
            );
        });

        test('rejects a category that is its own parent', async () => {
            await expect(
                db.update(categories).set({ parentId: categoryId }).where(eq(categories.id, categoryId)),
            ).rejects.toMatchObject(CHECK_VIOLATION);
        });

        test('cannot delete a category that still has products', async () => {
            await insertProduct({ categoryId });
            await expect(db.delete(categories).where(eq(categories.id, categoryId))).rejects.toMatchObject(
                RESTRICT_VIOLATION,
            );
        });
    });

    describe('products', () => {
        test('a draft needs only a slug, creator and title', async () => {
            const row = await insertProduct();
            expect(row).toMatchObject({ status: 'draft', description: '', digitalPriceCents: null, license: null });
        });

        test('rejects a duplicate slug', async () => {
            await insertProduct({ slug: 'dragon' });
            await expect(insertProduct({ slug: 'dragon' })).rejects.toMatchObject(UNIQUE_VIOLATION);
        });

        test.each([
            ['negative digital price', { digitalPriceCents: -1 }],
            ['zero print price', { printBasePriceCents: 0 }],
            ['paid file under a CC licence', { digitalPriceCents: 500, license: 'cc_by' as const }],
            ['non-positive dimension', { sizeXMm: 0 }],
        ])('rejects %s', async (_, overrides) => {
            await expect(insertProduct(overrides)).rejects.toMatchObject(CHECK_VIOLATION);
        });

        test('a paid file may use the shop licences', async () => {
            await expect(insertProduct({ digitalPriceCents: 500, license: 'commercial' })).resolves.toBeDefined();
        });

        test('publishes a complete free download and a print-only product', async () => {
            await expect(insertProduct(published())).resolves.toBeDefined();
            await expect(
                insertProduct(published({ digitalPriceCents: null, license: null, printBasePriceCents: 2500 })),
            ).resolves.toBeDefined();
        });

        test.each([
            ['without published_at', { publishedAt: null }],
            ['without a category', { categoryId: null }],
            ['without any offer', { digitalPriceCents: null, printBasePriceCents: null }],
            ['offering a file without a licence', { license: null }],
        ])('refuses to publish %s', async (_, overrides) => {
            await expect(insertProduct(published(overrides))).rejects.toMatchObject(CHECK_VIOLATION);
        });

        test('maintains the search vector and finds products by title and description', async () => {
            await insertProduct(published({ title: 'Articulated Dragon', description: 'Prints in place.' }));
            await insertProduct(published({ title: 'Cable Clip', description: 'Keeps desk wires tidy.' }));

            const search = (q: string) =>
                db
                    .select({ title: products.title })
                    .from(products)
                    .where(sql`${products.searchVector} @@ websearch_to_tsquery('english', ${q})`);

            expect(await search('dragons')).toEqual([{ title: 'Articulated Dragon' }]);
            expect(await search('wire')).toEqual([{ title: 'Cable Clip' }]);
        });

        test('cannot delete a creator who still owns products', async () => {
            await insertProduct();
            await expect(db.delete(users).where(eq(users.id, CREATOR_ID))).rejects.toMatchObject(RESTRICT_VIOLATION);
        });
    });

    describe('images and files', () => {
        test('are deleted with their product', async () => {
            const { id } = await insertProduct();
            await db.insert(productImages).values({
                productId: id,
                storageKey: `products/${id}/images/a.webp`,
                alt: 'Dragon on a desk',
                width: 1200,
                height: 900,
                sizeBytes: 50_000,
            });
            await db.insert(productFiles).values(file(id));

            await db.delete(products).where(eq(products.id, id));

            expect(await db.select().from(productImages).where(eq(productImages.productId, id))).toEqual([]);
            expect(await db.select().from(productFiles).where(eq(productFiles.productId, id))).toEqual([]);
        });

        test('stores sizes above the 32-bit integer limit', async () => {
            const { id } = await insertProduct();
            const [row] = await db
                .insert(productFiles)
                .values(file(id, { sizeBytes: 3 * 1024 ** 3 }))
                .returning();
            expect(row?.sizeBytes).toBe(3 * 1024 ** 3);
        });

        test('allows several download files but only one preview', async () => {
            const { id } = await insertProduct();
            await db.insert(productFiles).values([file(id), file(id, { format: '3mf', filename: 'dragon.3mf' })]);

            const preview = { kind: 'preview' as const, format: 'glb' as const, filename: 'preview.glb' };
            await db.insert(productFiles).values(file(id, preview));
            await expect(db.insert(productFiles).values(file(id, preview))).rejects.toMatchObject(UNIQUE_VIOLATION);
        });

        test.each([
            ['a non-GLB preview', { kind: 'preview' as const, format: 'stl' as const }],
            ['a malformed sha256', { sha256: 'not-a-hash' }],
            ['an empty file', { sizeBytes: 0 }],
        ])('rejects %s', async (_, overrides) => {
            const { id } = await insertProduct();
            await expect(db.insert(productFiles).values(file(id, overrides))).rejects.toMatchObject(CHECK_VIOLATION);
        });
    });
});
