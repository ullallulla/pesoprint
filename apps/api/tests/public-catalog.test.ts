import { fileURLToPath } from 'node:url';

import {
    apiErrorSchema,
    catalogCategoryTreeSchema,
    catalogHomeSchema,
    catalogProductListSchema,
    catalogProductSchema,
    catalogSitemapSchema,
} from '@app/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vite-plus/test';

import { createDatabase, runMigrations } from '../src/db/client.ts';
import { categories, productFiles, productImages, products, users, type NewProduct } from '../src/db/schema.ts';
import { createCatalogService, prefixTsQuery } from '../src/services/catalog.ts';
import { buildApp, createFakeStorage } from './helpers.ts';

describe('prefixTsQuery', () => {
    test.each([
        ['drag', 'drag:*'],
        ['Drag, STAND!', 'drag:* & stand:*'],
        ["it's a 3d-print", 'it:* & s:* & a:* & 3d:* & print:*'],
        ['käsityö', 'käsityö:*'],
        ['!!! ---', null],
        ['a b c d e f g h i j', 'a:* & b:* & c:* & d:* & e:* & f:* & g:* & h:*'],
    ])('%j → %j', (input, expected) => {
        expect(prefixTsQuery(input)).toBe(expected);
    });

    test("can't carry tsquery syntax", () => {
        expect(prefixTsQuery("dragon') | !(x")).toBe('dragon:* & x:*');
    });
});

const url = process.env.TEST_DATABASE_URL;

// Runs against a real Postgres. Start it with `vp run db:up` (local) — CI provides one as a service.
describe.skipIf(!url)('public catalogue (integration)', () => {
    const { db, pool } = createDatabase(url ?? '');
    const storage = createFakeStorage();
    const app = buildApp({ catalog: createCatalogService(db, storage) });
    const CREATOR_ID = 'user_public_catalog';
    const DAY = 24 * 60 * 60 * 1000;
    const now = Date.now();

    async function get(path: string) {
        return app.request(`/api/catalog${path}`);
    }

    async function list(query = '') {
        const res = await get(`/products${query}`);
        expect(res.status).toBe(200);
        return catalogProductListSchema.parse(await res.json());
    }

    const slugs = (cards: { slug: string }[]) => cards.map((card) => card.slug);

    async function resetCatalogue() {
        await db.delete(products);
        await db.delete(categories).where(sql`${categories.parentId} IS NOT NULL`);
        await db.delete(categories);
    }

    beforeAll(async () => {
        await runMigrations(db, fileURLToPath(new URL('../drizzle', import.meta.url)));
        await resetCatalogue();
        await db.delete(users).where(eq(users.id, CREATOR_ID));
        await db.insert(users).values({ id: CREATOR_ID, email: 'catalog@example.com' });

        const [toys] = await db.insert(categories).values({ slug: 'toys', name: 'Toys', position: 0 }).returning();
        const [printInPlace] = await db
            .insert(categories)
            .values({ slug: 'print-in-place', name: 'Print-in-place', parentId: toys!.id })
            .returning();
        const [desk] = await db.insert(categories).values({ slug: 'desk', name: 'Desk', position: 1 }).returning();
        await db.insert(categories).values({ slug: 'empty', name: 'Empty', position: 2 });

        const base = { creatorId: CREATOR_ID, status: 'published' as const };
        const insert = async (values: Omit<NewProduct, 'creatorId'>) => {
            const [row] = await db
                .insert(products)
                .values({ ...base, ...values })
                .returning();
            return row!;
        };

        const dragon = await insert({
            slug: 'articulated-dragon',
            title: 'Articulated Dragon',
            description: 'Prints in place without supports.',
            categoryId: printInPlace!.id,
            digitalPriceCents: 0,
            printBasePriceCents: 2490,
            license: 'cc_by',
            sizeXMm: 180,
            sizeYMm: 60,
            sizeZMm: 25,
            publishedAt: new Date(now - 3 * DAY),
            featuredAt: new Date(now),
            downloadCount: 120,
        });
        await insert({
            slug: 'cable-clip',
            title: 'Cable Clip',
            description: 'Keeps desk wires tidy.',
            categoryId: desk!.id,
            digitalPriceCents: 450,
            license: 'standard_digital',
            publishedAt: new Date(now - 1 * DAY),
            downloadCount: 7,
        });
        await insert({
            slug: 'wooden-look-yoyo',
            title: 'Yo-yo',
            categoryId: toys!.id,
            printBasePriceCents: 990,
            publishedAt: new Date(now - 2 * DAY),
            featuredAt: new Date(now - DAY),
        });
        // Never public:
        await insert({ slug: 'secret-draft', title: 'Dragon draft', status: 'draft', categoryId: toys!.id });
        await insert({
            slug: 'old-dragon',
            title: 'Old Dragon',
            status: 'archived',
            categoryId: toys!.id,
            printBasePriceCents: 100,
            publishedAt: new Date(now - 10 * DAY),
            featuredAt: new Date(now),
        });

        await db.insert(productImages).values([
            {
                productId: dragon.id,
                storageKey: 'p/dragon/side.webp',
                alt: 'Side',
                width: 800,
                height: 600,
                sizeBytes: 1,
                position: 1,
            },
            {
                productId: dragon.id,
                storageKey: 'p/dragon/front.webp',
                alt: 'Front',
                width: 1200,
                height: 900,
                sizeBytes: 1,
                position: 0,
            },
        ]);
        await db.insert(productFiles).values([
            {
                productId: dragon.id,
                kind: 'download',
                format: 'stl',
                filename: 'dragon.stl',
                storageKey: 'p/dragon/dragon.stl',
                sizeBytes: 5000,
            },
            {
                productId: dragon.id,
                kind: 'preview',
                format: 'glb',
                filename: 'preview.glb',
                storageKey: 'p/dragon/preview.glb',
                sizeBytes: 400,
            },
        ]);
    });

    afterAll(async () => {
        await resetCatalogue();
        await db.delete(users).where(eq(users.id, CREATOR_ID));
        await pool.end();
    });

    test('home: featured by most recently featured, newest by publication; drafts and archived never appear', async () => {
        const home = catalogHomeSchema.parse(await (await get('/home')).json());
        expect(slugs(home.featured)).toEqual(['articulated-dragon', 'wooden-look-yoyo']);
        expect(slugs(home.newest)).toEqual(['cable-clip', 'wooden-look-yoyo', 'articulated-dragon']);
    });

    test('cards carry the cover (lowest position), category and prices', async () => {
        const { featured } = catalogHomeSchema.parse(await (await get('/home')).json());
        expect(featured[0]).toEqual({
            slug: 'articulated-dragon',
            title: 'Articulated Dragon',
            category: { slug: 'print-in-place', name: 'Print-in-place' },
            cover: { url: 'https://assets.test/p/dragon/front.webp', alt: 'Front', width: 1200, height: 900 },
            digitalPriceCents: 0,
            printBasePriceCents: 2490,
            downloadCount: 120,
            publishedAt: expect.any(String),
        });
        expect(featured[1]?.cover).toBeNull();
    });

    test('category tree: menu order, subcategories, and published counts that include subcategories', async () => {
        const { categories: tree } = catalogCategoryTreeSchema.parse(await (await get('/categories')).json());
        expect(
            tree.map((c) => [c.slug, c.productCount, c.children.map((child) => [child.slug, child.productCount])]),
        ).toEqual([
            ['toys', 2, [['print-in-place', 1]]],
            ['desk', 1, []],
            ['empty', 0, []],
        ]);
    });

    describe('browsing', () => {
        test('newest first by default', async () => {
            const page = await list();
            expect(page).toMatchObject({ sort: 'newest', total: 3, page: 1, pageSize: 24 });
            expect(slugs(page.products)).toEqual(['cable-clip', 'wooden-look-yoyo', 'articulated-dragon']);
            expect(page.products.map((p) => p.downloadCount)).toEqual([7, 0, 120]);
        });

        test('a top-level category includes its subcategories', async () => {
            expect(slugs((await list('?category=toys')).products)).toEqual(['wooden-look-yoyo', 'articulated-dragon']);
            expect(slugs((await list('?category=print-in-place')).products)).toEqual(['articulated-dragon']);
        });

        test('404 for an unknown category', async () => {
            const res = await get('/products?category=nope');
            expect(res.status).toBe(404);
            expect(apiErrorSchema.parse(await res.json()).error.message).toBe('Category not found.');
        });

        test.each([
            ['free', ['articulated-dragon']],
            ['paid', ['cable-clip']],
            ['print', ['wooden-look-yoyo', 'articulated-dragon']],
        ])('offer=%s', async (offer, expected) => {
            expect(slugs((await list(`?offer=${offer}`)).products)).toEqual(expected);
        });

        test.each([
            ['price-asc', ['articulated-dragon', 'cable-clip', 'wooden-look-yoyo']],
            ['price-desc', ['wooden-look-yoyo', 'cable-clip', 'articulated-dragon']],
            ['title', ['articulated-dragon', 'cable-clip', 'wooden-look-yoyo']],
            ['downloads', ['articulated-dragon', 'cable-clip', 'wooden-look-yoyo']],
        ])('sort=%s', async (sort, expected) => {
            expect(slugs((await list(`?sort=${sort}`)).products)).toEqual(expected);
        });

        test('pagination', async () => {
            const page = await list('?pageSize=2&page=2');
            expect(page).toMatchObject({ page: 2, pageSize: 2, total: 3 });
            expect(slugs(page.products)).toEqual(['articulated-dragon']);
        });

        test('400 for a page size above the limit', async () => {
            expect((await get('/products?pageSize=500')).status).toBe(400);
        });
    });

    describe('search', () => {
        test('matches the start of words, in the title and the description; sorted by relevance', async () => {
            const page = await list('?q=drag');
            expect(page.sort).toBe('relevance');
            // The draft and the archived product also contain "dragon" but stay hidden.
            expect(slugs(page.products)).toEqual(['articulated-dragon']);
            expect(slugs((await list('?q=wires')).products)).toEqual(['cable-clip']);
        });

        test('all words must match, and filters still apply', async () => {
            expect(slugs((await list('?q=dragon%20supports')).products)).toEqual(['articulated-dragon']);
            expect((await list('?q=dragon%20wires')).total).toBe(0);
            expect((await list('?q=dragon&offer=paid')).total).toBe(0);
        });

        test('input with no words matches nothing instead of failing', async () => {
            expect((await list('?q=%21%21%21')).total).toBe(0);
        });

        test('another sort can be chosen while searching', async () => {
            expect((await list('?q=d&sort=title')).sort).toBe('title');
        });
    });

    describe('product page', () => {
        test('returns the gallery, the category with its parent, the preview and the download contents', async () => {
            const res = await get('/products/articulated-dragon');
            expect(res.status).toBe(200);
            const product = catalogProductSchema.parse(await res.json());

            expect(product).toMatchObject({
                title: 'Articulated Dragon',
                description: 'Prints in place without supports.',
                category: { slug: 'print-in-place', name: 'Print-in-place', parent: { slug: 'toys', name: 'Toys' } },
                license: 'cc_by',
                size: { x: 180, y: 60, z: 25 },
                preview: { url: 'https://assets.test/p/dragon/preview.glb' },
                files: [{ format: 'stl', filename: 'dragon.stl', sizeBytes: 5000 }],
            });
            expect(product.images.map((image) => image.alt)).toEqual(['Front', 'Side']);
            expect(product.cover?.alt).toBe('Front');
            // No storage keys or private file locations leak into the public response.
            expect(JSON.stringify(product)).not.toContain('p/dragon/dragon.stl');
            expect(JSON.stringify(product)).not.toContain('storageKey');
        });

        test('a top-level category has no parent', async () => {
            const product = catalogProductSchema.parse(await (await get('/products/wooden-look-yoyo')).json());
            expect(product.category).toEqual({ slug: 'toys', name: 'Toys', parent: null });
            expect(product.size).toBeNull();
        });

        test.each(['secret-draft', 'old-dragon', 'no-such-model'])(
            '404 for %s (draft, archived, unknown)',
            async (slug) => {
                const res = await get(`/products/${slug}`);
                expect(res.status).toBe(404);
                expect(apiErrorSchema.parse(await res.json()).error.message).toBe('Product not found.');
            },
        );
    });

    test('sitemap lists published products and only categories that have some', async () => {
        const sitemap = catalogSitemapSchema.parse(await (await get('/sitemap')).json());
        expect(sitemap.products.map((p) => p.slug)).toEqual(['articulated-dragon', 'cable-clip', 'wooden-look-yoyo']);
        expect(sitemap.categories.map((c) => c.slug)).toEqual(['toys', 'print-in-place', 'desk']);
    });

    test('without file storage, images are left out instead of pointing nowhere', async () => {
        const noStorage = buildApp({ catalog: createCatalogService(db, null) });
        const product = catalogProductSchema.parse(
            await (await noStorage.request('/api/catalog/products/articulated-dragon')).json(),
        );
        expect(product).toMatchObject({ cover: null, images: [], preview: null });
    });
});
