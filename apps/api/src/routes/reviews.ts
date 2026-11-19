import { myReviewSchema, productReviewsQuerySchema, productReviewsSchema, reviewInputSchema } from '@app/shared';
import { createRoute, z } from '@hono/zod-openapi';

import type { VerifySessionToken } from '../lib/auth.ts';
import { errorResponse } from '../lib/openapi.ts';
import { createRouter } from '../lib/router.ts';
import { requireUser } from '../middleware/auth.ts';
import type { ReviewsService } from '../services/reviews.ts';

export interface ReviewDeps {
    verifySessionToken: VerifySessionToken;
    reviews: ReviewsService;
}

const productIdParams = z.object({
    productId: z.uuid().openapi({ param: { name: 'productId', in: 'path' } }),
});

const myReviewResponse = (description: string) => ({
    description,
    content: { 'application/json': { schema: myReviewSchema } },
});

const WHO_MAY_REVIEW = [
    'Only people who have the model may review it, never its creator: they bought its file, a print of it was',
    'delivered to them, or it is a free download and they downloaded it while signed in.',
].join('\n');

export function reviewRoutes(deps: ReviewDeps) {
    const signedIn = requireUser(deps.verifySessionToken);

    const listRoute = createRoute({
        tags: ['Reviews'],
        method: 'get',
        path: '/catalog/products/{slug}/reviews',
        summary: "A model's reviews",
        description: "One page of a published model's reviews, newest first. Reviews the shop hid aren't listed.",
        request: {
            params: z.object({
                slug: z
                    .string()
                    .max(100)
                    .openapi({ param: { name: 'slug', in: 'path' } }),
            }),
            query: productReviewsQuerySchema,
        },
        responses: {
            200: {
                description: 'One page of reviews.',
                content: { 'application/json': { schema: productReviewsSchema } },
            },
            400: errorResponse('Invalid query parameters.'),
            404: errorResponse('No published product with this slug.'),
        },
    });

    const mineRoute = createRoute({
        tags: ['Reviews'],
        security: [{ bearerAuth: [] }],
        middleware: [signedIn] as const,
        method: 'get',
        path: '/me/reviews/{productId}',
        summary: 'Your review of a model',
        description: `Your review of a published model, if you wrote one, and whether you may write one.\n${WHO_MAY_REVIEW}`,
        request: { params: productIdParams },
        responses: {
            200: myReviewResponse('Your review, if any.'),
            400: errorResponse('The id is not a UUID.'),
            401: errorResponse('Sign in required.'),
            404: errorResponse('No published model with this id.'),
        },
    });

    const saveRoute = createRoute({
        tags: ['Reviews'],
        security: [{ bearerAuth: [] }],
        middleware: [signedIn] as const,
        method: 'put',
        path: '/me/reviews/{productId}',
        summary: 'Write or change your review',
        description: [
            'Writes your review of a published model, or replaces the one you wrote. A review the shop hid stays hidden.',
            WHO_MAY_REVIEW,
        ].join('\n'),
        request: {
            params: productIdParams,
            body: { required: true, content: { 'application/json': { schema: reviewInputSchema } } },
        },
        responses: {
            200: myReviewResponse('Your review as saved.'),
            400: errorResponse('Invalid input.'),
            401: errorResponse('Sign in required.'),
            403: errorResponse("You may not review this model: you don't have it, or you made it."),
            404: errorResponse('No published model with this id.'),
        },
    });

    const deleteRoute = createRoute({
        tags: ['Reviews'],
        security: [{ bearerAuth: [] }],
        middleware: [signedIn] as const,
        method: 'delete',
        path: '/me/reviews/{productId}',
        summary: 'Delete your review',
        description: "Deletes your review of the model. Succeeds when there's none, too.",
        request: { params: productIdParams },
        responses: {
            204: { description: 'Deleted.' },
            400: errorResponse('The id is not a UUID.'),
            401: errorResponse('Sign in required.'),
        },
    });

    return createRouter()
        .openapi(listRoute, async (c) => {
            return c.json(await deps.reviews.list(c.req.valid('param').slug, c.req.valid('query')), 200);
        })
        .openapi(mineRoute, async (c) => {
            const review = await deps.reviews.mine(c.get('auth'), c.req.valid('param').productId);
            c.header('Cache-Control', 'no-store');
            return c.json(review, 200);
        })
        .openapi(saveRoute, async (c) => {
            const review = await deps.reviews.save(c.get('auth'), c.req.valid('param').productId, c.req.valid('json'));
            return c.json(review, 200);
        })
        .openapi(deleteRoute, async (c) => {
            await deps.reviews.remove(c.get('auth'), c.req.valid('param').productId);
            return c.body(null, 204);
        });
}
