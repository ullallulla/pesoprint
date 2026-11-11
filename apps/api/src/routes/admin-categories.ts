import { adminCategoryListSchema, categorySchema, createCategorySchema, updateCategorySchema } from '@app/shared';
import { createRoute } from '@hono/zod-openapi';

import type { VerifySessionToken } from '../lib/auth.ts';
import { adminAuthResponses, errorResponse, idParams } from '../lib/openapi.ts';
import { createRouter } from '../lib/router.ts';
import { requireAdmin } from '../middleware/auth.ts';
import type { CategoriesService } from '../services/categories.ts';

export interface AdminCategoryDeps {
    verifySessionToken: VerifySessionToken;
    categories: CategoriesService;
}

export function adminCategoryRoutes(deps: AdminCategoryDeps) {
    const adminOnly = requireAdmin(deps.verifySessionToken);

    const listRoute = createRoute({
        tags: ['Admin: categories'],
        security: [{ bearerAuth: [] }],
        middleware: [adminOnly] as const,
        method: 'get',
        path: '/admin/categories',
        summary: 'List categories',
        description: 'Every category with its product count, ordered by position then name.',
        responses: {
            200: {
                description: 'All categories.',
                content: { 'application/json': { schema: adminCategoryListSchema } },
            },
            ...adminAuthResponses,
        },
    });

    const createCategoryRoute = createRoute({
        tags: ['Admin: categories'],
        security: [{ bearerAuth: [] }],
        middleware: [adminOnly] as const,
        method: 'post',
        path: '/admin/categories',
        summary: 'Create a category',
        description: 'The parent, if given, must be a top-level category (categories nest at most two levels).',
        request: {
            body: { required: true, content: { 'application/json': { schema: createCategorySchema } } },
        },
        responses: {
            201: { description: 'The new category.', content: { 'application/json': { schema: categorySchema } } },
            400: errorResponse('Invalid input, or the parent breaks the two-level rule.'),
            ...adminAuthResponses,
            409: errorResponse('The slug is already taken.'),
        },
    });

    const updateCategoryRoute = createRoute({
        tags: ['Admin: categories'],
        security: [{ bearerAuth: [] }],
        middleware: [adminOnly] as const,
        method: 'patch',
        path: '/admin/categories/{id}',
        summary: 'Update a category',
        description: 'Changes only the fields that are sent. Send `parentId: null` to move it to the top level.',
        request: {
            params: idParams,
            body: { required: true, content: { 'application/json': { schema: updateCategorySchema } } },
        },
        responses: {
            200: {
                description: 'The updated category.',
                content: { 'application/json': { schema: categorySchema } },
            },
            400: errorResponse('Invalid input, or the move breaks the two-level rule.'),
            ...adminAuthResponses,
            404: errorResponse('No category with this id.'),
            409: errorResponse('The slug is already taken.'),
        },
    });

    const deleteCategoryRoute = createRoute({
        tags: ['Admin: categories'],
        security: [{ bearerAuth: [] }],
        middleware: [adminOnly] as const,
        method: 'delete',
        path: '/admin/categories/{id}',
        summary: 'Delete a category',
        description: 'Only empty categories can be deleted.',
        request: { params: idParams },
        responses: {
            204: { description: 'Deleted.' },
            400: errorResponse('The id is not a UUID.'),
            ...adminAuthResponses,
            404: errorResponse('No category with this id.'),
            409: errorResponse('The category still has subcategories or products.'),
        },
    });

    return createRouter()
        .openapi(listRoute, async (c) => {
            return c.json({ categories: await deps.categories.list() }, 200);
        })
        .openapi(createCategoryRoute, async (c) => {
            return c.json(await deps.categories.create(c.req.valid('json')), 201);
        })
        .openapi(updateCategoryRoute, async (c) => {
            return c.json(await deps.categories.update(c.req.valid('param').id, c.req.valid('json')), 200);
        })
        .openapi(deleteCategoryRoute, async (c) => {
            await deps.categories.remove(c.req.valid('param').id);
            return c.body(null, 204);
        });
}
