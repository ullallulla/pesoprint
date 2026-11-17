import {
    checkoutRequestSchema,
    checkoutStartSchema,
    orderListQuerySchema,
    orderListSchema,
    orderSchema,
    SHIPPING_COUNTRIES,
} from '@app/shared';
import { createRoute, z } from '@hono/zod-openapi';

import type { VerifySessionToken } from '../lib/auth.ts';
import { errorResponse } from '../lib/openapi.ts';
import { createRouter } from '../lib/router.ts';
import { requireUser } from '../middleware/auth.ts';
import type { OrdersService } from '../services/orders.ts';

export interface OrderDeps {
    verifySessionToken: VerifySessionToken;
    orders: OrdersService;
}

export function orderRoutes(deps: OrderDeps) {
    const checkoutRoute = createRoute({
        tags: ['Orders'],
        security: [{ bearerAuth: [] }],
        middleware: [requireUser(deps.verifySessionToken)] as const,
        method: 'post',
        path: '/checkout',
        summary: 'Start paying for a cart',
        description: [
            "Prices the cart again from today's catalogue, creates a pending order, and creates a Stripe Checkout",
            'Session for it. Send the buyer to `paymentUrl`. Stripe sends them back to `/orders/{id}` on the web',
            "app when they're done, or to `/cart` if they go back. The order is paid only once Stripe says so.",
            '',
            'An order with model files needs `immediateDeliveryConsent: true`: the buyer agreed that the files are',
            'delivered right away, which ends their 14-day right of withdrawal (EU rule for digital content).',
            '',
            "An order with prints adds one parcel's shipping (the size of the largest print). Stripe's page asks",
            `for the shipping address (${SHIPPING_COUNTRIES.join(', ')} only for now) and a phone number for the`,
            'delivery notice; the order keeps the address once paid.',
        ].join('\n'),
        request: {
            body: { required: true, content: { 'application/json': { schema: checkoutRequestSchema } } },
        },
        responses: {
            201: {
                description: 'The order was created; send the buyer to the payment page.',
                content: { 'application/json': { schema: checkoutStartSchema } },
            },
            400: errorResponse('Invalid items, or model files without `immediateDeliveryConsent`.'),
            401: errorResponse('Sign in required.'),
            409: errorResponse(
                'The cart changed (something is no longer for sale, or already owned) or is empty, or the account is still being set up.',
            ),
            502: errorResponse("Stripe couldn't be reached. Nothing was charged."),
            503: errorResponse('Payments are not configured on this server.'),
        },
    });

    const listRoute = createRoute({
        tags: ['Orders'],
        security: [{ bearerAuth: [] }],
        middleware: [requireUser(deps.verifySessionToken)] as const,
        method: 'get',
        path: '/orders',
        summary: 'Your orders',
        description: [
            'Your orders that were paid for, refunded ones included, the newest first. An order with prints has',
            '`carrier` and `trackingNumber` once the shop ships it, and `deliveredAt` once it arrives. Unpaid',
            "and cancelled checkouts aren't listed. Files are on `GET /orders/{id}` and in your library.",
        ].join('\n'),
        request: { query: orderListQuerySchema },
        responses: {
            200: { description: 'One page of orders.', content: { 'application/json': { schema: orderListSchema } } },
            400: errorResponse('Invalid query parameters.'),
            401: errorResponse('Sign in required.'),
        },
    });

    const orderRoute = createRoute({
        tags: ['Orders'],
        security: [{ bearerAuth: [] }],
        middleware: [requireUser(deps.verifySessionToken)] as const,
        method: 'get',
        path: '/orders/{id}',
        summary: 'One of your orders',
        description:
            "A pending order is checked with Stripe first, so a buyer who's back from paying sees it paid even before the webhook arrives. A paid order lists its files to download.",
        request: {
            params: z.object({ id: z.uuid().openapi({ param: { name: 'id', in: 'path' } }) }),
        },
        responses: {
            200: { description: 'The order.', content: { 'application/json': { schema: orderSchema } } },
            400: errorResponse('The id is not a UUID.'),
            401: errorResponse('Sign in required.'),
            404: errorResponse('No such order, or it is not yours.'),
        },
    });

    return createRouter()
        .openapi(checkoutRoute, async (c) => {
            const start = await deps.orders.checkout(c.get('auth'), c.req.valid('json'));
            return c.json(start, 201);
        })
        .openapi(listRoute, async (c) => {
            const list = await deps.orders.list(c.get('auth'), c.req.valid('query'));
            c.header('Cache-Control', 'no-store');
            return c.json(list, 200);
        })
        .openapi(orderRoute, async (c) => {
            const order = await deps.orders.get(c.get('auth'), c.req.valid('param').id);
            c.header('Cache-Control', 'no-store');
            return c.json(order, 200);
        });
}
