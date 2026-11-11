import { fileURLToPath } from 'node:url';

import { adminCategoryListSchema, apiErrorSchema, categorySchema, type Category } from '@app/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vite-plus/test';

import { createDatabase, runMigrations } from '../src/db/client.ts';
import { categories, products, users } from '../src/db/schema.ts';
import { createCategoriesService } from '../src/services/categories.ts';
import { bearer, buildApp, tokens } from './helpers.ts';

describe('admin category routes: auth and validation', () => {
    const app = buildApp();

    test.each([
        ['GET', '/api/admin/categories'],
        ['POST', '/api/admin/categories'],
        ['PATCH', '/api/admin/categories/0190a6d2-3b7e-7000-8000-000000000000'],
        ['DELETE', '/api/admin/categories/0190a6d2-3b7e-7000-8000-000000000000'],
    ])('%s %s is admin only', async (method, path) => {
        expect((await app.request(path, { method })).status).toBe(401);
        expect((await app.request(path, { method, ...bearer(tokens.customer) })).status).toBe(403);
    });

    test('400 for an id that is not a UUID', async () => {
        const res = await app.request('/api/admin/categories/42', { method: 'DELETE', ...bearer(tokens.admin) });
        expect(res.status).toBe(400);
    });

    test('400 with field issues for an invalid body', async () => {
        const res = await app.request('/api/admin/categories', {
            method: 'POST',
            headers: { ...bearer(tokens.admin).headers, 'content-type': 'application/json' },
            body: JSON.stringify({ slug: 'Not A Slug', name: '' }),
        });

        expect(res.status).toBe(400);
        const { error } = apiErrorSchema.parse(await res.json());
        expect(error.issues?.map((issue) => issue.path).sort()).toEqual(['name', 'slug']);
    });
});

const url = process.env.TEST_DATABASE_URL;

// Runs against a real Postgres. Start it with `vp run db:up` (local) — CI provides one as a service.
describe.skipIf(!url)('admin category routes (integration)', () => {
    const { db, pool } = createDatabase(url ?? '');
    const app = buildApp({ categories: createCategoriesService(db) });
    const CREATOR_ID = 'user_categories_creator';

    function call(method: string, path: string, body?: unknown) {
        return app.request(`/api/admin/categories${path}`, {
            method,
            headers: { ...bearer(tokens.admin).headers, 'content-type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
    }

    async function create(body: Record<string, unknown>): Promise<Category> {
        const res = await call('POST', '', body);
        expect(res.status).toBe(201);
        return categorySchema.parse(await res.json());
    }

    async function expectError(res: Response, status: number, code: string) {
        expect(res.status).toBe(status);
        const { error } = apiErrorSchema.parse(await res.json());
        expect(error.code).toBe(code);
        return error;
    }

    async function resetCatalogue() {
        await db.delete(products);
        await db.delete(categories).where(sql`${categories.parentId} IS NOT NULL`);
        await db.delete(categories);
    }

    beforeAll(async () => {
        await runMigrations(db, fileURLToPath(new URL('../drizzle', import.meta.url)));
        await resetCatalogue();
        await db.delete(users).where(eq(users.id, CREATOR_ID));
        await db.insert(users).values({ id: CREATOR_ID, email: 'categories@example.com', role: 'admin' });
    });

    beforeEach(resetCatalogue);

    afterAll(async () => {
        await resetCatalogue();
        await db.delete(users).where(eq(users.id, CREATOR_ID));
        await pool.end();
    });

    describe('create and list', () => {
        test('creates a category with defaults', async () => {
            const toys = await create({ slug: 'toys', name: 'Toys' });
            expect(toys).toMatchObject({ slug: 'toys', name: 'Toys', description: null, parentId: null, position: 0 });
        });

        test('lists categories by position, then name, with product counts', async () => {
            const toys = await create({ slug: 'toys', name: 'Toys', position: 1 });
            await create({ slug: 'home', name: 'Home', position: 0 });
            await create({ slug: 'desk', name: 'Desk', position: 1 });
            await db.insert(products).values([
                { slug: 'dragon', title: 'Dragon', creatorId: CREATOR_ID, categoryId: toys.id },
                { slug: 'yoyo', title: 'Yo-yo', creatorId: CREATOR_ID, categoryId: toys.id },
            ]);

            const res = await call('GET', '');
            expect(res.status).toBe(200);
            const list = adminCategoryListSchema.parse(await res.json()).categories;
            expect(list.map((c) => [c.slug, c.productCount])).toEqual([
                ['home', 0],
                ['desk', 0],
                ['toys', 2],
            ]);
        });

        test('409 for a duplicate slug', async () => {
            await create({ slug: 'toys', name: 'Toys' });
            const error = await expectError(
                await call('POST', '', { slug: 'toys', name: 'More toys' }),
                409,
                'conflict',
            );
            expect(error.message).toMatch(/"toys" already exists/);
        });
    });

    describe('two-level rule', () => {
        test('a subcategory can be created under a top-level category', async () => {
            const toys = await create({ slug: 'toys', name: 'Toys' });
            const fidget = await create({ slug: 'fidget', name: 'Fidget toys', parentId: toys.id });
            expect(fidget.parentId).toBe(toys.id);
        });

        test('rejects a third level', async () => {
            const toys = await create({ slug: 'toys', name: 'Toys' });
            const fidget = await create({ slug: 'fidget', name: 'Fidget toys', parentId: toys.id });

            const error = await expectError(
                await call('POST', '', { slug: 'spinners', name: 'Spinners', parentId: fidget.id }),
                400,
                'validation_failed',
            );
            expect(error.issues).toEqual([{ path: 'parentId', message: expect.stringMatching(/two levels/) }]);
        });

        test('rejects a parent that does not exist', async () => {
            const error = await expectError(
                await call('POST', '', {
                    slug: 'toys',
                    name: 'Toys',
                    parentId: '0190a6d2-3b7e-7000-8000-000000000000',
                }),
                400,
                'validation_failed',
            );
            expect(error.message).toMatch(/does not exist/);
        });

        test('rejects moving a category that has subcategories (prevents A → B → A)', async () => {
            const toys = await create({ slug: 'toys', name: 'Toys' });
            const fidget = await create({ slug: 'fidget', name: 'Fidget toys', parentId: toys.id });

            const error = await expectError(
                await call('PATCH', `/${toys.id}`, { parentId: fidget.id }),
                400,
                'validation_failed',
            );
            // fidget is itself a subcategory, so the "parent is a subcategory" rule fires first.
            expect(error.issues?.[0]?.path).toBe('parentId');

            const home = await create({ slug: 'home', name: 'Home' });
            const moved = await expectError(
                await call('PATCH', `/${toys.id}`, { parentId: home.id }),
                400,
                'validation_failed',
            );
            expect(moved.message).toMatch(/has subcategories/);
        });

        test('rejects a category as its own parent', async () => {
            const toys = await create({ slug: 'toys', name: 'Toys' });
            const error = await expectError(
                await call('PATCH', `/${toys.id}`, { parentId: toys.id }),
                400,
                'validation_failed',
            );
            expect(error.message).toMatch(/its own parent/);
        });
    });

    describe('update', () => {
        test('changes only the fields that are sent, and clears with null', async () => {
            const toys = await create({ slug: 'toys', name: 'Toys', description: 'Fun things' });

            const res = await call('PATCH', `/${toys.id}`, { name: 'Toys & games', description: null });
            expect(res.status).toBe(200);
            expect(categorySchema.parse(await res.json())).toEqual({
                ...toys,
                name: 'Toys & games',
                description: null,
            });
        });

        test('moves a subcategory back to the top level', async () => {
            const toys = await create({ slug: 'toys', name: 'Toys' });
            const fidget = await create({ slug: 'fidget', name: 'Fidget toys', parentId: toys.id });

            const res = await call('PATCH', `/${fidget.id}`, { parentId: null });
            expect(categorySchema.parse(await res.json()).parentId).toBeNull();
        });

        test('an empty body returns the category unchanged', async () => {
            const toys = await create({ slug: 'toys', name: 'Toys' });
            const res = await call('PATCH', `/${toys.id}`, {});
            expect(categorySchema.parse(await res.json())).toEqual(toys);
        });

        test('409 when renaming to a taken slug, 404 for an unknown id', async () => {
            await create({ slug: 'toys', name: 'Toys' });
            const home = await create({ slug: 'home', name: 'Home' });

            await expectError(await call('PATCH', `/${home.id}`, { slug: 'toys' }), 409, 'conflict');
            const [unchanged] = await db.select().from(categories).where(eq(categories.id, home.id));
            expect(unchanged?.slug).toBe('home');

            const missing = await expectError(
                await call('PATCH', '/0190a6d2-3b7e-7000-8000-000000000000', { name: 'x' }),
                404,
                'not_found',
            );
            expect(missing.message).toBe('Category not found.');
        });
    });

    describe('delete', () => {
        test('deletes an empty category', async () => {
            const toys = await create({ slug: 'toys', name: 'Toys' });

            const res = await call('DELETE', `/${toys.id}`);
            expect(res.status).toBe(204);
            expect(await db.select().from(categories)).toEqual([]);
        });

        test('409 while it has subcategories', async () => {
            const toys = await create({ slug: 'toys', name: 'Toys' });
            await create({ slug: 'fidget', name: 'Fidget toys', parentId: toys.id });

            const error = await expectError(await call('DELETE', `/${toys.id}`), 409, 'conflict');
            expect(error.message).toMatch(/1 subcategory/);
        });

        test('409 while it has products', async () => {
            const toys = await create({ slug: 'toys', name: 'Toys' });
            await db
                .insert(products)
                .values({ slug: 'dragon', title: 'Dragon', creatorId: CREATOR_ID, categoryId: toys.id });

            const error = await expectError(await call('DELETE', `/${toys.id}`), 409, 'conflict');
            expect(error.message).toMatch(/1 product\./);
        });

        test('404 for an unknown id', async () => {
            const error = await expectError(
                await call('DELETE', '/0190a6d2-3b7e-7000-8000-000000000000'),
                404,
                'not_found',
            );
            expect(error.message).toBe('Category not found.');
        });
    });
});
