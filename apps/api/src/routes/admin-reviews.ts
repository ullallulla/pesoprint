import {
    adminReviewListQuerySchema,
    adminReviewListSchema,
    adminReviewSchema,
    setReviewHiddenSchema,
} from '@app/shared';
import { createRoute } from '@hono/zod-openapi';

import type { VerifySessionToken } from '../lib/auth.ts';
import { adminAuthResponses, errorResponse, idParams } from '../lib/openapi.ts';
import { createRouter } from '../lib/router.ts';
import { requireAdmin } from '../middleware/auth.ts';
import type { AdminReviewsService } from '../services/admin-reviews.ts';

export interface AdminReviewDeps {
    verifySessionToken: VerifySessionToken;
    adminReviews: AdminReviewsService;
}

export function adminReviewRoutes(deps: AdminReviewDeps) {
    const adminOnly = requireAdmin(deps.verifySessionToken);

    const listRoute = createRoute({
        tags: ['Admin: reviews'],
        security: [{ bearerAuth: [] }],
        middleware: [adminOnly] as const,
        method: 'get',
        path: '/admin/reviews',
        summary: 'List reviews',
        description: 'Every review, hidden ones too, newest first, with the model and who wrote it.',
        request: { query: adminReviewListQuerySchema },
        responses: {
            200: {
                description: 'One page of reviews.',
                content: { 'application/json': { schema: adminReviewListSchema } },
            },
            400: errorResponse('Invalid query parameters.'),
            ...adminAuthResponses,
        },
    });

    const visibilityRoute = createRoute({
        tags: ['Admin: reviews'],
        security: [{ bearerAuth: [] }],
        middleware: [adminOnly] as const,
        method: 'post',
        path: '/admin/reviews/{id}/visibility',
        summary: 'Hide or show a review',
        description: [
            "A hidden review isn't shown on the model's page and doesn't count towards its rating. Its author still",
            "sees it (marked hidden) and can change or delete it, but changing it doesn't show it again.",
        ].join('\n'),
        request: {
            params: idParams,
            body: { required: true, content: { 'application/json': { schema: setReviewHiddenSchema } } },
        },
        responses: {
            200: {
                description: 'The review.',
                content: { 'application/json': { schema: adminReviewSchema } },
            },
            400: errorResponse('Invalid input.'),
            ...adminAuthResponses,
            404: errorResponse('No review with this id.'),
        },
    });

    return createRouter()
        .openapi(listRoute, async (c) => c.json(await deps.adminReviews.list(c.req.valid('query')), 200))
        .openapi(visibilityRoute, async (c) => {
            const review = await deps.adminReviews.setHidden(c.req.valid('param').id, c.req.valid('json'));
            return c.json(review, 200);
        });
}
