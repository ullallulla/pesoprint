import { fileURLToPath } from 'node:url';

import { adminProductListSchema, adminProductSchema, apiErrorSchema, type AdminProduct } from '@app/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vite-plus/test';

import { createDatabase, runMigrations } from '../src/db/client.ts';
import { categories, productFiles, productImages, products, users } from '../src/db/schema.ts';
import { createProductsService } from '../src/services/products.ts';
import { bearer, buildApp, tokens } from './helpers.ts';

const UNKNOWN_ID = '0190a6d2-3b7e-7000-8000-000000000000';

describe('admin product routes: auth and validation', () => {
    const app = buildApp();

    test.each([
        ['GET', '/api/admin/products'],
        ['POST', '/api/admin/products'],
        ['GET', `/api/admin/products/${UNKNOWN_ID}`],
        ['PATCH', `/api/admin/products/${UNKNOWN_ID}`],
        ['DELETE', `/api/admin/products/${UNKNOWN_ID}`],
        ['POST', `/api/admin/products/${UNKNOWN_ID}/publish`],
        ['POST', `/api/admin/products/${UNKNOWN_ID}/archive`],
        ['PUT', `/api/admin/products/${UNKNOWN_ID}/featured`],
        ['DELETE', `/api/admin/products/${UNKNOWN_ID}/featured`],
    ])('%s %s is admin only', async (method, path) => {
        expect((await app.request(path, { method })).status).toBe(401);
        expect((await app.request(path, { method, ...bearer(tokens.customer) })).status).toBe(403);
    });

    test('400 for an invalid body', async () => {
        const res = await app.request('/api/admin/products', {
            method: 'POST',
            headers: { ...bearer(tokens.admin).headers, 'content-type': 'application/json' },
            body: JSON.stringify({ slug: 'dragon', title: 'Dragon', digitalPriceCents: 4.99 }),
        });

        expect(res.status).toBe(400);
        const { error } = apiErrorSchema.parse(await res.json());
        expect(error.issues?.map((issue) => issue.path)).toEqual(['digitalPriceCents']);
    });
});

const url = process.env.TEST_DATABASE_URL;

// Runs against a real Postgres. Start it with `vp run db:up` (local) — CI provides one as a service.
describe.skipIf(!url)('admin product routes (integration)', () => {
    const { db, pool } = createDatabase(url ?? '');
    const app = buildApp({ products: createProductsService(db) });
    /** The user id the fake verifier returns for `tokens.admin`. */
    const ADMIN_ID = 'user_admin';
    let categoryId: string;

    function call(method: string, path: string, body?: unknown) {
        return app.request(`/api/admin/products${path}`, {
            method,
            headers: { ...bearer(tokens.admin).headers, 'content-type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
    }

    async function expectProduct(res: Response, status = 200): Promise<AdminProduct> {
        expect(res.status).toBe(status);
        return adminProductSchema.parse(await res.json());
    }

    async function expectError(res: Response, status: number, code: string) {
        expect(res.status).toBe(status);
        const { error } = apiErrorSchema.parse(await res.json());
        expect(error.code).toBe(code);
        return error;
    }

    const create = async (body: Record<string, unknown>) => expectProduct(await call('POST', '', body), 201);

    /** Adds the image and download file that publishing requires (uploads arrive in step 5). */
    async function addContent(productId: string) {
        await db.insert(productImages).values({
            productId,
            storageKey: `products/${productId}/images/${crypto.randomUUID()}.webp`,
            alt: 'The model',
            width: 1200,
            height: 900,
            sizeBytes: 40_000,
        });
        await db.insert(productFiles).values({
            productId,
            kind: 'download',
            format: 'stl',
            filename: 'model.stl',
            storageKey: `products/${productId}/files/${crypto.randomUUID()}.stl`,
            sizeBytes: 1_000_000,
        });
    }

    /** A free-download product that is ready to publish. */
    async function createReady(slug = 'dragon') {
        const product = await create({ slug, title: 'Dragon', categoryId, digitalPriceCents: 0, license: 'cc_by' });
        await addContent(product.id);
        return product;
    }

    async function createPublished(slug = 'dragon') {
        const { id } = await createReady(slug);
        return expectProduct(await call('POST', `/${id}/publish`));
    }

    async function resetCatalogue() {
        await db.delete(products);
        await db.delete(categories).where(sql`${categories.parentId} IS NOT NULL`);
        await db.delete(categories);
    }

    beforeAll(async () => {
        await runMigrations(db, fileURLToPath(new URL('../drizzle', import.meta.url)));
        await resetCatalogue();
        await db.delete(users).where(eq(users.id, ADMIN_ID));
        await db.insert(users).values({ id: ADMIN_ID, email: 'admin@example.com', role: 'admin' });
    });

    beforeEach(async () => {
        await resetCatalogue();
        const [row] = await db.insert(categories).values({ slug: 'toys', name: 'Toys' }).returning();
        categoryId = row!.id;
    });

    afterAll(async () => {
        await resetCatalogue();
        await db.delete(users).where(eq(users.id, ADMIN_ID));
        await pool.end();
    });

    describe('create', () => {
        test('creates a draft owned by the caller', async () => {
            const product = await create({ slug: 'dragon', title: 'Dragon' });
            expect(product).toMatchObject({
                slug: 'dragon',
                title: 'Dragon',
                status: 'draft',
                creatorId: ADMIN_ID,
                description: '',
                digitalPriceCents: null,
                publishedAt: null,
                images: [],
                files: [],
            });
        });

        test('ignores a status in the body: new products are always drafts', async () => {
            const product = await create({ slug: 'dragon', title: 'Dragon', status: 'published' });
            expect(product.status).toBe('draft');
        });

        test('409 for a taken slug', async () => {
            await create({ slug: 'dragon', title: 'Dragon' });
            const error = await expectError(
                await call('POST', '', { slug: 'dragon', title: 'Other' }),
                409,
                'conflict',
            );
            expect(error.issues).toEqual([{ path: 'slug', message: expect.any(String) }]);
        });

        test('400 for an unknown category', async () => {
            const error = await expectError(
                await call('POST', '', { slug: 'dragon', title: 'Dragon', categoryId: UNKNOWN_ID }),
                400,
                'validation_failed',
            );
            expect(error.issues?.[0]?.path).toBe('categoryId');
        });

        test('400 for a paid file under a CC licence, even on a draft', async () => {
            const error = await expectError(
                await call('POST', '', { slug: 'dragon', title: 'Dragon', digitalPriceCents: 500, license: 'cc_by' }),
                400,
                'validation_failed',
            );
            expect(error.issues?.[0]?.path).toBe('license');
        });

        test("409 when the caller's user row hasn't been synced from Clerk", async () => {
            await db.delete(users).where(eq(users.id, ADMIN_ID));
            try {
                const error = await expectError(
                    await call('POST', '', { slug: 'dragon', title: 'Dragon' }),
                    409,
                    'conflict',
                );
                expect(error.message).toMatch(/not been synced/);
            } finally {
                await db.insert(users).values({ id: ADMIN_ID, email: 'admin@example.com', role: 'admin' });
            }
        });
    });

    describe('get and list', () => {
        test('get returns images and files in position order', async () => {
            const { id } = await createReady();
            const product = await expectProduct(await call('GET', `/${id}`));
            expect(product.images).toHaveLength(1);
            expect(product.files).toEqual([expect.objectContaining({ kind: 'download', filename: 'model.stl' })]);
        });

        test('404 for an unknown id', async () => {
            const error = await expectError(await call('GET', `/${UNKNOWN_ID}`), 404, 'not_found');
            expect(error.message).toBe('Product not found.');
        });

        test('filters by status and text, and paginates', async () => {
            await createPublished('dragon');
            await create({ slug: 'cable-clip', title: 'Cable clip' });
            await create({ slug: 'desk-tidy', title: 'Desk tidy' });

            const drafts = adminProductListSchema.parse(await (await call('GET', '?status=draft')).json());
            expect(drafts.products.map((p) => p.slug).sort()).toEqual(['cable-clip', 'desk-tidy']);

            const search = adminProductListSchema.parse(await (await call('GET', '?q=CLIP')).json());
            expect(search.products.map((p) => p.slug)).toEqual(['cable-clip']);

            const page2 = adminProductListSchema.parse(await (await call('GET', '?pageSize=2&page=2')).json());
            expect(page2).toMatchObject({ page: 2, pageSize: 2, total: 3 });
            expect(page2.products).toHaveLength(1);
        });

        test('text search treats % and _ literally', async () => {
            await create({ slug: 'dragon', title: 'Dragon' });
            const res = adminProductListSchema.parse(await (await call('GET', '?q=%25')).json());
            expect(res.total).toBe(0);
        });
    });

    describe('update', () => {
        test('changes only the fields that are sent, and clears with null', async () => {
            const { id } = await create({ slug: 'dragon', title: 'Dragon', printBasePriceCents: 2500, sizeXMm: 120 });

            const updated = await expectProduct(
                await call('PATCH', `/${id}`, { title: 'Flexi dragon', printBasePriceCents: null }),
            );
            expect(updated).toMatchObject({ title: 'Flexi dragon', printBasePriceCents: null, sizeXMm: 120 });
        });

        test('a draft can change its slug', async () => {
            const { id } = await create({ slug: 'dragon', title: 'Dragon' });
            const updated = await expectProduct(await call('PATCH', `/${id}`, { slug: 'flexi-dragon' }));
            expect(updated.slug).toBe('flexi-dragon');
        });

        test('the slug is locked once published, even after archiving', async () => {
            const { id } = await createPublished();
            await expectError(await call('PATCH', `/${id}`, { slug: 'flexi-dragon' }), 409, 'conflict');

            await call('POST', `/${id}/archive`);
            const error = await expectError(await call('PATCH', `/${id}`, { slug: 'flexi-dragon' }), 409, 'conflict');
            expect(error.issues?.[0]?.path).toBe('slug');

            // Sending the unchanged slug is fine (e.g. an admin form that posts every field).
            await expectProduct(await call('PATCH', `/${id}`, { slug: 'dragon', title: 'Dragon v2' }));
        });

        test('a published product must stay publishable', async () => {
            const { id } = await createPublished();

            const error = await expectError(
                await call('PATCH', `/${id}`, { categoryId: null, license: null }),
                409,
                'conflict',
            );
            expect(error.issues?.map((issue) => issue.path)).toEqual(['categoryId', 'license']);

            const [row] = await db.select().from(products).where(eq(products.id, id));
            expect(row?.categoryId).toBe(categoryId);
        });

        test('400 when making a file paid while it has a CC licence', async () => {
            const { id } = await create({ slug: 'dragon', title: 'Dragon', digitalPriceCents: 0, license: 'cc_by' });
            const error = await expectError(
                await call('PATCH', `/${id}`, { digitalPriceCents: 500 }),
                400,
                'validation_failed',
            );
            expect(error.issues?.[0]?.path).toBe('license');
        });
    });

    describe('publish', () => {
        test('publishes a ready product and sets published_at', async () => {
            const product = await createPublished();
            expect(product.status).toBe('published');
            expect(product.publishedAt).not.toBeNull();
        });

        test('409 listing every problem when not ready', async () => {
            const { id } = await create({ slug: 'dragon', title: 'Dragon', digitalPriceCents: 0 });

            const error = await expectError(await call('POST', `/${id}/publish`), 409, 'conflict');
            expect(error.issues?.map((issue) => issue.path)).toEqual(['categoryId', 'license', 'images', 'files']);
        });

        test('is idempotent', async () => {
            const first = await createPublished();
            const again = await expectProduct(await call('POST', `/${first.id}/publish`));
            expect(again.publishedAt).toBe(first.publishedAt);
        });

        test('republishing an archived product keeps the first publication date', async () => {
            const first = await createPublished();
            await expectProduct(await call('POST', `/${first.id}/archive`));

            const republished = await expectProduct(await call('POST', `/${first.id}/publish`));
            expect(republished).toMatchObject({ status: 'published', publishedAt: first.publishedAt });
        });
    });

    describe('archive', () => {
        test('archives a published product and un-features it', async () => {
            const { id } = await createPublished();
            await expectProduct(await call('PUT', `/${id}/featured`));

            const archived = await expectProduct(await call('POST', `/${id}/archive`));
            expect(archived).toMatchObject({ status: 'archived', featuredAt: null });
        });

        test('409 for a draft', async () => {
            const { id } = await create({ slug: 'dragon', title: 'Dragon' });
            const error = await expectError(await call('POST', `/${id}/archive`), 409, 'conflict');
            expect(error.message).toMatch(/Delete the draft instead/);
        });
    });

    describe('featured', () => {
        test('featuring sets featured_at, featuring again moves it to the top, unfeaturing clears it', async () => {
            const { id } = await createPublished();

            const featured = await expectProduct(await call('PUT', `/${id}/featured`));
            expect(featured.featuredAt).not.toBeNull();

            const again = await expectProduct(await call('PUT', `/${id}/featured`));
            expect(Date.parse(again.featuredAt!)).toBeGreaterThan(Date.parse(featured.featuredAt!));

            const unfeatured = await expectProduct(await call('DELETE', `/${id}/featured`));
            expect(unfeatured.featuredAt).toBeNull();
        });

        test('a draft can be featured ahead of publishing', async () => {
            const { id } = await create({ slug: 'dragon', title: 'Dragon' });
            const featured = await expectProduct(await call('PUT', `/${id}/featured`));
            expect(featured.featuredAt).not.toBeNull();
        });

        test('409 for an archived product', async () => {
            const { id } = await createPublished();
            await call('POST', `/${id}/archive`);
            const error = await expectError(await call('PUT', `/${id}/featured`), 409, 'conflict');
            expect(error.message).toMatch(/Archived/);
        });
    });

    describe('delete', () => {
        test('deletes a draft with its images and files', async () => {
            const { id } = await createReady();

            expect((await call('DELETE', `/${id}`)).status).toBe(204);
            expect(await db.select().from(productFiles).where(eq(productFiles.productId, id))).toEqual([]);
        });

        test('409 once published, even after archiving', async () => {
            const { id } = await createPublished();
            await call('POST', `/${id}/archive`);

            const error = await expectError(await call('DELETE', `/${id}`), 409, 'conflict');
            expect(error.message).toMatch(/Archive it instead/);
        });

        test('404 for an unknown id', async () => {
            const error = await expectError(await call('DELETE', `/${UNKNOWN_ID}`), 404, 'not_found');
            expect(error.message).toBe('Product not found.');
        });
    });
});
