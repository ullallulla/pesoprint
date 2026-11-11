import {
    catalogCategoryTreeSchema,
    catalogHomeSchema,
    catalogProductListQuerySchema,
    catalogProductListSchema,
    catalogProductSchema,
    catalogSitemapSchema,
} from '@app/shared';
import { createRoute, z } from '@hono/zod-openapi';

import { errorResponse } from '../lib/openapi.ts';
import { createRouter } from '../lib/router.ts';
import type { CatalogService } from '../services/catalog.ts';

export interface CatalogDeps {
    catalog: CatalogService;
}

const json = <T extends z.ZodType>(schema: T, description: string) => ({
    description,
    content: { 'application/json': { schema } },
});

const homeRoute = createRoute({
    tags: ['Catalogue'],
    method: 'get',
    path: '/catalog/home',
    summary: 'Home page sections',
    description: 'Featured products (most recently featured first) and the newest products.',
    responses: { 200: json(catalogHomeSchema, 'The home page sections.') },
});

const categoriesRoute = createRoute({
    tags: ['Catalogue'],
    method: 'get',
    path: '/catalog/categories',
    summary: 'Category tree',
    description: 'Top-level categories with their subcategories, in menu order, with published product counts.',
    responses: { 200: json(catalogCategoryTreeSchema, 'All categories.') },
});

const listRoute = createRoute({
    tags: ['Catalogue'],
    method: 'get',
    path: '/catalog/products',
    summary: 'Browse and search products',
    description:
        'Published products, filtered by category (a top-level category includes its subcategories), search words and offer. The response says which sort was applied.',
    request: { query: catalogProductListQuerySchema },
    responses: {
        200: json(catalogProductListSchema, 'One page of products.'),
        400: errorResponse('Invalid query parameters.'),
        404: errorResponse('No category with this slug.'),
    },
});

const productRoute = createRoute({
    tags: ['Catalogue'],
    method: 'get',
    path: '/catalog/products/{slug}',
    summary: 'A product page',
    request: {
        params: z.object({
            slug: z
                .string()
                .max(100)
                .openapi({ param: { name: 'slug', in: 'path' } }),
        }),
    },
    responses: {
        200: json(catalogProductSchema, 'The product.'),
        404: errorResponse('No published product with this slug.'),
    },
});

const sitemapRoute = createRoute({
    tags: ['Catalogue'],
    method: 'get',
    path: '/catalog/sitemap',
    summary: 'Sitemap entries',
    description: 'Every published product and every category that has published products, for sitemap.xml.',
    responses: { 200: json(catalogSitemapSchema, 'Sitemap entries.') },
});

/** Public, read-only catalogue routes. No sign-in needed; only published products are returned. */
export function catalogRoutes(deps: CatalogDeps) {
    return createRouter()
        .openapi(homeRoute, async (c) => c.json(await deps.catalog.home(), 200))
        .openapi(categoriesRoute, async (c) => c.json({ categories: await deps.catalog.categories() }, 200))
        .openapi(listRoute, async (c) => c.json(await deps.catalog.list(c.req.valid('query')), 200))
        .openapi(productRoute, async (c) => c.json(await deps.catalog.product(c.req.valid('param').slug), 200))
        .openapi(sitemapRoute, async (c) => c.json(await deps.catalog.sitemap(), 200));
}
