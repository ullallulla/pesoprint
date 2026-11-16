import {
    adminColourListSchema,
    adminMaterialListSchema,
    colourSchema,
    createColourSchema,
    createMaterialSchema,
    materialColourSchema,
    materialSchema,
    setMaterialColourSchema,
    updateColourSchema,
    updateMaterialSchema,
} from '@app/shared';
import { createRoute, z } from '@hono/zod-openapi';

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
        summary: 'List materials',
        description:
            'Every material, active or not, with the colours you have it in. Both ordered by position, then name.',
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
        description:
            'Changes only the fields that are sent. Set `active: false` to hide it from buyers, `multicolour: false` ' +
            'to offer only single-colour prints in it.',
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
            409: errorResponse(
                'A material with this name already exists, or switching it off would leave a published model with nothing to sell.',
            ),
        },
    });

    const deleteMaterialRoute = createRoute({
        tags: ['Admin: materials'],
        security: [{ bearerAuth: [] }],
        middleware: [adminOnly] as const,
        method: 'delete',
        path: '/admin/materials/{id}',
        summary: 'Delete a material',
        description: 'A material that is in use can only be made inactive.',
        request: { params: idParams },
        responses: {
            204: { description: 'Deleted.' },
            400: errorResponse('The id is not a UUID.'),
            ...adminAuthResponses,
            404: errorResponse('No material with this id.'),
            409: errorResponse('The material is in use.'),
        },
    });

    const listColoursRoute = createRoute({
        tags: ['Admin: materials'],
        security: [{ bearerAuth: [] }],
        middleware: [adminOnly] as const,
        method: 'get',
        path: '/admin/colours',
        summary: 'List colours',
        description:
            'Every colour, ordered by position, then name. Which materials come in it, and their stock, is listed ' +
            'with the materials.',
        responses: {
            200: { description: 'All colours.', content: { 'application/json': { schema: adminColourListSchema } } },
            ...adminAuthResponses,
        },
    });

    const addColourRoute = createRoute({
        tags: ['Admin: materials'],
        security: [{ bearerAuth: [] }],
        middleware: [adminOnly] as const,
        method: 'post',
        path: '/admin/colours',
        summary: 'Add a colour',
        request: {
            body: { required: true, content: { 'application/json': { schema: createColourSchema } } },
        },
        responses: {
            201: { description: 'The new colour.', content: { 'application/json': { schema: colourSchema } } },
            400: errorResponse('Invalid input.'),
            ...adminAuthResponses,
            409: errorResponse('A colour with this name already exists (names ignore case).'),
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
            409: errorResponse('A colour with this name already exists.'),
        },
    });

    const deleteColourRoute = createRoute({
        tags: ['Admin: materials'],
        security: [{ bearerAuth: [] }],
        middleware: [adminOnly] as const,
        method: 'delete',
        path: '/admin/colours/{id}',
        summary: 'Delete a colour',
        description:
            'Materials stop coming in it. A colour that models offer in their colour options can not be deleted.',
        request: { params: idParams },
        responses: {
            204: { description: 'Deleted.' },
            400: errorResponse('The id is not a UUID.'),
            ...adminAuthResponses,
            404: errorResponse('No colour with this id.'),
            409: errorResponse('Models offer the colour.'),
        },
    });

    const materialColourParams = z.object({
        id: z.uuid().openapi({ param: { name: 'id', in: 'path' } }),
        colourId: z.uuid().openapi({ param: { name: 'colourId', in: 'path' } }),
    });

    const setMaterialColourRoute = createRoute({
        tags: ['Admin: materials'],
        security: [{ bearerAuth: [] }],
        middleware: [adminOnly] as const,
        method: 'put',
        path: '/admin/materials/{id}/colours/{colourId}',
        summary: 'Have a material in a colour',
        description:
            'Adds the colour to the material (you have this filament), or changes whether it is in stock. ' +
            'Out-of-stock filaments stay listed for buyers but can not be ordered.',
        request: {
            params: materialColourParams,
            body: { required: true, content: { 'application/json': { schema: setMaterialColourSchema } } },
        },
        responses: {
            200: {
                description: 'The colour as the material has it.',
                content: { 'application/json': { schema: materialColourSchema } },
            },
            400: errorResponse('Invalid input.'),
            ...adminAuthResponses,
            404: errorResponse('No material or colour with this id.'),
        },
    });

    const removeMaterialColourRoute = createRoute({
        tags: ['Admin: materials'],
        security: [{ bearerAuth: [] }],
        middleware: [adminOnly] as const,
        method: 'delete',
        path: '/admin/materials/{id}/colours/{colourId}',
        summary: 'No longer have a material in a colour',
        request: { params: materialColourParams },
        responses: {
            204: { description: 'Removed.' },
            400: errorResponse('An id is not a UUID.'),
            ...adminAuthResponses,
            404: errorResponse('The material does not come in this colour.'),
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
        .openapi(listColoursRoute, async (c) => {
            return c.json({ colours: await deps.materials.listColours() }, 200);
        })
        .openapi(addColourRoute, async (c) => {
            return c.json(await deps.materials.addColour(c.req.valid('json')), 201);
        })
        .openapi(updateColourRoute, async (c) => {
            return c.json(await deps.materials.updateColour(c.req.valid('param').id, c.req.valid('json')), 200);
        })
        .openapi(deleteColourRoute, async (c) => {
            await deps.materials.removeColour(c.req.valid('param').id);
            return c.body(null, 204);
        })
        .openapi(setMaterialColourRoute, async (c) => {
            const { id, colourId } = c.req.valid('param');
            return c.json(await deps.materials.setMaterialColour(id, colourId, c.req.valid('json')), 200);
        })
        .openapi(removeMaterialColourRoute, async (c) => {
            const { id, colourId } = c.req.valid('param');
            await deps.materials.removeMaterialColour(id, colourId);
            return c.body(null, 204);
        });
}
