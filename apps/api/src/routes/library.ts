import { libraryItemSchema, librarySchema } from '@app/shared';
import { createRoute, z } from '@hono/zod-openapi';

import type { VerifySessionToken } from '../lib/auth.ts';
import { errorResponse } from '../lib/openapi.ts';
import { createRouter } from '../lib/router.ts';
import { requireUser } from '../middleware/auth.ts';
import type { LibraryService } from '../services/library.ts';

export interface LibraryDeps {
    verifySessionToken: VerifySessionToken;
    library: LibraryService;
}

export function libraryRoutes(deps: LibraryDeps) {
    const listRoute = createRoute({
        tags: ['Library'],
        security: [{ bearerAuth: [] }],
        middleware: [requireUser(deps.verifySessionToken)] as const,
        method: 'get',
        path: '/library',
        summary: 'Models you own',
        description: [
            'Every model you bought, most recent first, with its files. Archived models stay here and their files',
            'stay downloadable through `POST /downloads/{fileId}`; `listed` says whether the model still has a public page.',
        ].join('\n'),
        responses: {
            200: { description: 'Your library.', content: { 'application/json': { schema: librarySchema } } },
            401: errorResponse('Sign in required.'),
        },
    });

    const itemRoute = createRoute({
        tags: ['Library'],
        security: [{ bearerAuth: [] }],
        middleware: [requireUser(deps.verifySessionToken)] as const,
        method: 'get',
        path: '/library/{productId}',
        summary: 'A model you own',
        description: 'Whether you own the model, and its files if you do. The product page uses it.',
        request: {
            params: z.object({ productId: z.uuid().openapi({ param: { name: 'productId', in: 'path' } }) }),
        },
        responses: {
            200: { description: 'You own it.', content: { 'application/json': { schema: libraryItemSchema } } },
            400: errorResponse('The id is not a UUID.'),
            401: errorResponse('Sign in required.'),
            404: errorResponse("You don't own this model, or there's no such model."),
        },
    });

    return createRouter()
        .openapi(listRoute, async (c) => {
            const items = await deps.library.list(c.get('auth'));
            c.header('Cache-Control', 'no-store');
            return c.json({ items }, 200);
        })
        .openapi(itemRoute, async (c) => {
            const item = await deps.library.item(c.get('auth'), c.req.valid('param').productId);
            c.header('Cache-Control', 'no-store');
            return c.json(item, 200);
        });
}
