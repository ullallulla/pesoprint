import { favouriteListSchema, favouriteStatusSchema, MAX_FAVOURITES } from '@app/shared';
import { createRoute, z } from '@hono/zod-openapi';

import type { VerifySessionToken } from '../lib/auth.ts';
import { errorResponse } from '../lib/openapi.ts';
import { createRouter } from '../lib/router.ts';
import { requireUser } from '../middleware/auth.ts';
import type { FavouritesService } from '../services/favourites.ts';

export interface FavouriteDeps {
    verifySessionToken: VerifySessionToken;
    favourites: FavouritesService;
}

const productIdParams = z.object({
    productId: z.uuid().openapi({ param: { name: 'productId', in: 'path' } }),
});

const statusResponse = (description: string) => ({
    description,
    content: { 'application/json': { schema: favouriteStatusSchema } },
});

export function favouriteRoutes(deps: FavouriteDeps) {
    const signedIn = requireUser(deps.verifySessionToken);

    const listRoute = createRoute({
        tags: ['Favourites'],
        security: [{ bearerAuth: [] }],
        middleware: [signedIn] as const,
        method: 'get',
        path: '/favourites',
        summary: 'Models you saved',
        description:
            "The models you saved with the heart button, most recently saved first. Models no longer for sale aren't listed.",
        responses: {
            200: {
                description: 'Your saved models.',
                content: { 'application/json': { schema: favouriteListSchema } },
            },
            401: errorResponse('Sign in required.'),
        },
    });

    const statusRoute = createRoute({
        tags: ['Favourites'],
        security: [{ bearerAuth: [] }],
        middleware: [signedIn] as const,
        method: 'get',
        path: '/favourites/{productId}',
        summary: 'Whether you saved a model',
        request: { params: productIdParams },
        responses: {
            200: statusResponse('Whether the model is saved.'),
            400: errorResponse('The id is not a UUID.'),
            401: errorResponse('Sign in required.'),
        },
    });

    const saveRoute = createRoute({
        tags: ['Favourites'],
        security: [{ bearerAuth: [] }],
        middleware: [signedIn] as const,
        method: 'put',
        path: '/favourites/{productId}',
        summary: 'Save a model',
        description: `Saves a published model. Saving it again changes nothing. Up to ${MAX_FAVOURITES} models.`,
        request: { params: productIdParams },
        responses: {
            200: statusResponse('Saved.'),
            400: errorResponse('The id is not a UUID.'),
            401: errorResponse('Sign in required.'),
            404: errorResponse('No published model with this id.'),
            409: errorResponse(`You already saved ${MAX_FAVOURITES} models, or your account isn't ready yet.`),
        },
    });

    const removeRoute = createRoute({
        tags: ['Favourites'],
        security: [{ bearerAuth: [] }],
        middleware: [signedIn] as const,
        method: 'delete',
        path: '/favourites/{productId}',
        summary: 'Forget a saved model',
        description: "Succeeds when the model wasn't saved, too.",
        request: { params: productIdParams },
        responses: {
            200: statusResponse('Not saved any more.'),
            400: errorResponse('The id is not a UUID.'),
            401: errorResponse('Sign in required.'),
        },
    });

    return createRouter()
        .openapi(listRoute, async (c) => {
            const items = await deps.favourites.list(c.get('auth'));
            c.header('Cache-Control', 'no-store');
            return c.json({ items }, 200);
        })
        .openapi(statusRoute, async (c) => {
            const status = await deps.favourites.status(c.get('auth'), c.req.valid('param').productId);
            c.header('Cache-Control', 'no-store');
            return c.json(status, 200);
        })
        .openapi(saveRoute, async (c) => {
            return c.json(await deps.favourites.save(c.get('auth'), c.req.valid('param').productId), 200);
        })
        .openapi(removeRoute, async (c) => {
            return c.json(await deps.favourites.remove(c.get('auth'), c.req.valid('param').productId), 200);
        });
}
