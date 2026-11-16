import {
    adminMaterialListSchema,
    colourSchema,
    createColourSchema,
    createMaterialSchema,
    materialSchema,
    updateColourSchema,
    updateMaterialSchema,
} from '@app/shared';
import { createRoute } from '@hono/zod-openapi';

import type { VerifySessionToken } from '../lib/auth.ts';
import { adminAuthResponses, errorResponse, idParams } from '../lib/openapi.ts';
import { createRouter } from '../lib/router.ts';
import { requireAdmin } from '../middleware/auth.ts';
import type { MaterialsService } from '../services/materials.ts';

export interface AdminMaterialDeps {
    verifySessionToken: VerifySessionToken;
    materials: MaterialsService;
}

export function adminMaterialRoutes(deps: AdminMaterialDeps) {
    const adminOnly = requireAdmin(deps.verifySessionToken);

    const listRoute = createRoute({
        tags: ['Admin: materials'],
        security: [{ bearerAuth: [] }],
        middleware: [adminOnly] as const,
        method: 'get',
        path: '/admin/materials',
        summary: 'List materials and their colours',
        description: 'Every material, active or not, with all its colours. Both ordered by position, then name.',
        responses: {
            200: {
                description: 'All materials.',
                content: { 'application/json': { schema: adminMaterialListSchema } },
            },
            ...adminAuthResponses,
        },
    });

    const createMaterialRoute = createRoute({
        tags: ['Admin: materials'],
        security: [{ bearerAuth: [] }],
        middleware: [adminOnly] as const,
        method: 'post',
        path: '/admin/materials',
        summary: 'Create a material',
        request: {
            body: { required: true, content: { 'application/json': { schema: createMaterialSchema } } },
        },
        responses: {
            201: { description: 'The new material.', content: { 'application/json': { schema: materialSchema } } },
            400: errorResponse('Invalid input.'),
            ...adminAuthResponses,
            409: errorResponse('A material with this name already exists (names ignore case).'),
        },
    });

    const updateMaterialRoute = createRoute({
        tags: ['Admin: materials'],
        security: [{ bearerAuth: [] }],
        middleware: [adminOnly] as const,
        method: 'patch',
        path: '/admin/materials/{id}',
        summary: 'Update a material',
        description: 'Changes only the fields that are sent. Set `active: false` to hide it from buyers.',
        request: {
            params: idParams,
            body: { required: true, content: { 'application/json': { schema: updateMaterialSchema } } },
        },
        responses: {
            200: {
                description: 'The updated material.',
                content: { 'application/json': { schema: materialSchema } },
            },
            400: errorResponse('Invalid input.'),
            ...adminAuthResponses,
            404: errorResponse('No material with this id.'),
            409: errorResponse('A material with this name already exists.'),
        },
    });

    const deleteMaterialRoute = createRoute({
        tags: ['Admin: materials'],
        security: [{ bearerAuth: [] }],
        middleware: [adminOnly] as const,
        method: 'delete',
        path: '/admin/materials/{id}',
        summary: 'Delete a material',
        description: 'Deletes its colours too. A material that is in use can only be made inactive.',
        request: { params: idParams },
        responses: {
            204: { description: 'Deleted.' },
            400: errorResponse('The id is not a UUID.'),
            ...adminAuthResponses,
            404: errorResponse('No material with this id.'),
            409: errorResponse('The material or one of its colours is in use.'),
        },
    });

    const addColourRoute = createRoute({
        tags: ['Admin: materials'],
        security: [{ bearerAuth: [] }],
        middleware: [adminOnly] as const,
        method: 'post',
        path: '/admin/materials/{id}/colours',
        summary: 'Add a colour to a material',
        request: {
            params: idParams,
            body: { required: true, content: { 'application/json': { schema: createColourSchema } } },
        },
        responses: {
            201: { description: 'The new colour.', content: { 'application/json': { schema: colourSchema } } },
            400: errorResponse('Invalid input.'),
            ...adminAuthResponses,
            404: errorResponse('No material with this id.'),
            409: errorResponse('The material already has a colour with this name (names ignore case).'),
        },
    });

    const updateColourRoute = createRoute({
        tags: ['Admin: materials'],
        security: [{ bearerAuth: [] }],
        middleware: [adminOnly] as const,
        method: 'patch',
        path: '/admin/colours/{id}',
        summary: 'Update a colour',
        description: 'Changes only the fields that are sent. Set `inStock: false` when you run out of it.',
        request: {
            params: idParams,
            body: { required: true, content: { 'application/json': { schema: updateColourSchema } } },
        },
        responses: {
            200: { description: 'The updated colour.', content: { 'application/json': { schema: colourSchema } } },
            400: errorResponse('Invalid input.'),
            ...adminAuthResponses,
            404: errorResponse('No colour with this id.'),
            409: errorResponse('The material already has a colour with this name.'),
        },
    });

    const deleteColourRoute = createRoute({
        tags: ['Admin: materials'],
        security: [{ bearerAuth: [] }],
        middleware: [adminOnly] as const,
        method: 'delete',
        path: '/admin/colours/{id}',
        summary: 'Delete a colour',
        description: 'A colour that is in use can only be marked out of stock.',
        request: { params: idParams },
        responses: {
            204: { description: 'Deleted.' },
            400: errorResponse('The id is not a UUID.'),
            ...adminAuthResponses,
            404: errorResponse('No colour with this id.'),
            409: errorResponse('The colour is in use.'),
        },
    });

    return createRouter()
        .openapi(listRoute, async (c) => {
            return c.json({ materials: await deps.materials.list() }, 200);
        })
        .openapi(createMaterialRoute, async (c) => {
            return c.json(await deps.materials.create(c.req.valid('json')), 201);
        })
        .openapi(updateMaterialRoute, async (c) => {
            return c.json(await deps.materials.update(c.req.valid('param').id, c.req.valid('json')), 200);
        })
        .openapi(deleteMaterialRoute, async (c) => {
            await deps.materials.remove(c.req.valid('param').id);
            return c.body(null, 204);
        })
        .openapi(addColourRoute, async (c) => {
            return c.json(await deps.materials.addColour(c.req.valid('param').id, c.req.valid('json')), 201);
        })
        .openapi(updateColourRoute, async (c) => {
            return c.json(await deps.materials.updateColour(c.req.valid('param').id, c.req.valid('json')), 200);
        })
        .openapi(deleteColourRoute, async (c) => {
            await deps.materials.removeColour(c.req.valid('param').id);
            return c.body(null, 204);
        });
}
