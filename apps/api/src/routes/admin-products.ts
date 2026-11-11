import {
    adminProductListQuerySchema,
    adminProductListSchema,
    adminProductSchema,
    createProductSchema,
    updateProductSchema,
} from '@app/shared';
import { createRoute } from '@hono/zod-openapi';

import type { VerifySessionToken } from '../lib/auth.ts';
import { adminAuthResponses, errorResponse, idParams } from '../lib/openapi.ts';
import { createRouter } from '../lib/router.ts';
import { requireAdmin } from '../middleware/auth.ts';
import type { ProductsService } from '../services/products.ts';

export interface AdminProductDeps {
    verifySessionToken: VerifySessionToken;
    products: ProductsService;
}

const productResponse = (description: string) => ({
    description,
    content: { 'application/json': { schema: adminProductSchema } },
});

const notFoundResponse = errorResponse('No product with this id.');
const invalidIdResponse = errorResponse('The id is not a UUID.');

export function adminProductRoutes(deps: AdminProductDeps) {
    const adminOnly = requireAdmin(deps.verifySessionToken);

    const listRoute = createRoute({
        tags: ['Admin: products'],
        security: [{ bearerAuth: [] }],
        middleware: [adminOnly] as const,
        method: 'get',
        path: '/admin/products',
        summary: 'List products',
        description: 'Products of every status, most recently updated first. Filter by status, category or text.',
        request: { query: adminProductListQuerySchema },
        responses: {
            200: {
                description: 'One page of products.',
                content: { 'application/json': { schema: adminProductListSchema } },
            },
            400: errorResponse('Invalid query parameters.'),
            ...adminAuthResponses,
        },
    });

    const getRoute = createRoute({
        tags: ['Admin: products'],
        security: [{ bearerAuth: [] }],
        middleware: [adminOnly] as const,
        method: 'get',
        path: '/admin/products/{id}',
        summary: 'Get a product',
        description: 'The product with its images and files.',
        request: { params: idParams },
        responses: {
            200: productResponse('The product.'),
            400: invalidIdResponse,
            ...adminAuthResponses,
            404: notFoundResponse,
        },
    });

    const createProductRoute = createRoute({
        tags: ['Admin: products'],
        security: [{ bearerAuth: [] }],
        middleware: [adminOnly] as const,
        method: 'post',
        path: '/admin/products',
        summary: 'Create a draft',
        description: 'New products are always drafts owned by the caller. Only `slug` and `title` are required.',
        request: {
            body: { required: true, content: { 'application/json': { schema: createProductSchema } } },
        },
        responses: {
            201: productResponse('The new draft.'),
            400: errorResponse('Invalid input, an unknown category, or a paid file with a non-shop licence.'),
            ...adminAuthResponses,
            409: errorResponse('The slug is taken, or your account has not been synced yet.'),
        },
    });

    const updateProductRoute = createRoute({
        tags: ['Admin: products'],
        security: [{ bearerAuth: [] }],
        middleware: [adminOnly] as const,
        method: 'patch',
        path: '/admin/products/{id}',
        summary: 'Update a product',
        description:
            'Changes only the fields that are sent; `null` clears a field. The slug is locked once the product has been published, and a published product must stay ready to publish.',
        request: {
            params: idParams,
            body: { required: true, content: { 'application/json': { schema: updateProductSchema } } },
        },
        responses: {
            200: productResponse('The updated product.'),
            400: errorResponse('Invalid input, an unknown category, or a paid file with a non-shop licence.'),
            ...adminAuthResponses,
            404: notFoundResponse,
            409: errorResponse(
                'The slug is taken or locked, or the change would make a published product unpublishable (see `issues`).',
            ),
        },
    });

    const deleteProductRoute = createRoute({
        tags: ['Admin: products'],
        security: [{ bearerAuth: [] }],
        middleware: [adminOnly] as const,
        method: 'delete',
        path: '/admin/products/{id}',
        summary: 'Delete a draft',
        description: 'Only drafts that were never published can be deleted. Archive published products instead.',
        request: { params: idParams },
        responses: {
            204: { description: 'Deleted.' },
            400: invalidIdResponse,
            ...adminAuthResponses,
            404: notFoundResponse,
            409: errorResponse('The product has been published.'),
        },
    });

    const publishRoute = createRoute({
        tags: ['Admin: products'],
        security: [{ bearerAuth: [] }],
        middleware: [adminOnly] as const,
        method: 'post',
        path: '/admin/products/{id}/publish',
        summary: 'Publish a product',
        description:
            'Makes a draft or archived product public. If it is not ready, the 409 lists every problem in `issues`.',
        request: { params: idParams },
        responses: {
            200: productResponse('The published product.'),
            400: invalidIdResponse,
            ...adminAuthResponses,
            404: notFoundResponse,
            409: errorResponse('The product is not ready to publish (see `issues`).'),
        },
    });

    const archiveRoute = createRoute({
        tags: ['Admin: products'],
        security: [{ bearerAuth: [] }],
        middleware: [adminOnly] as const,
        method: 'post',
        path: '/admin/products/{id}/archive',
        summary: 'Archive a product',
        description: 'Hides a published product from the catalogue and un-features it. Buyers keep their downloads.',
        request: { params: idParams },
        responses: {
            200: productResponse('The archived product.'),
            400: invalidIdResponse,
            ...adminAuthResponses,
            404: notFoundResponse,
            409: errorResponse('The product is a draft.'),
        },
    });

    const featureRoute = createRoute({
        tags: ['Admin: products'],
        security: [{ bearerAuth: [] }],
        middleware: [adminOnly] as const,
        method: 'put',
        path: '/admin/products/{id}/featured',
        summary: 'Feature a product',
        description:
            'Puts the product first in the featured section. Featuring an already featured product moves it back to the top. Drafts can be featured ahead of publishing.',
        request: { params: idParams },
        responses: {
            200: productResponse('The featured product.'),
            400: invalidIdResponse,
            ...adminAuthResponses,
            404: notFoundResponse,
            409: errorResponse('The product is archived.'),
        },
    });

    const unfeatureRoute = createRoute({
        tags: ['Admin: products'],
        security: [{ bearerAuth: [] }],
        middleware: [adminOnly] as const,
        method: 'delete',
        path: '/admin/products/{id}/featured',
        summary: 'Stop featuring a product',
        request: { params: idParams },
        responses: {
            200: productResponse('The product, no longer featured.'),
            400: invalidIdResponse,
            ...adminAuthResponses,
            404: notFoundResponse,
        },
    });

    return createRouter()
        .openapi(listRoute, async (c) => {
            return c.json(await deps.products.list(c.req.valid('query')), 200);
        })
        .openapi(getRoute, async (c) => {
            return c.json(await deps.products.get(c.req.valid('param').id), 200);
        })
        .openapi(createProductRoute, async (c) => {
            return c.json(await deps.products.create(c.get('auth').userId, c.req.valid('json')), 201);
        })
        .openapi(updateProductRoute, async (c) => {
            return c.json(await deps.products.update(c.req.valid('param').id, c.req.valid('json')), 200);
        })
        .openapi(deleteProductRoute, async (c) => {
            await deps.products.remove(c.req.valid('param').id);
            return c.body(null, 204);
        })
        .openapi(publishRoute, async (c) => {
            return c.json(await deps.products.publish(c.req.valid('param').id), 200);
        })
        .openapi(archiveRoute, async (c) => {
            return c.json(await deps.products.archive(c.req.valid('param').id), 200);
        })
        .openapi(featureRoute, async (c) => {
            return c.json(await deps.products.setFeatured(c.req.valid('param').id, true), 200);
        })
        .openapi(unfeatureRoute, async (c) => {
            return c.json(await deps.products.setFeatured(c.req.valid('param').id, false), 200);
        });
}
