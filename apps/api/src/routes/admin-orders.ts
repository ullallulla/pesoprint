import {
    adminOrderListQuerySchema,
    adminOrderListSchema,
    adminOrderSchema,
    updateOrderStatusSchema,
} from '@app/shared';
import { createRoute } from '@hono/zod-openapi';

import type { VerifySessionToken } from '../lib/auth.ts';
import { adminAuthResponses, errorResponse, idParams } from '../lib/openapi.ts';
import { createRouter } from '../lib/router.ts';
import { requireAdmin } from '../middleware/auth.ts';
import type { AdminOrdersService } from '../services/admin-orders.ts';

export interface AdminOrderDeps {
    verifySessionToken: VerifySessionToken;
    adminOrders: AdminOrdersService;
}

const orderResponse = (description: string) => ({
    description,
    content: { 'application/json': { schema: adminOrderSchema } },
});

const notFoundResponse = errorResponse('No order with prints with this id.');

export function adminOrderRoutes(deps: AdminOrderDeps) {
    const adminOnly = requireAdmin(deps.verifySessionToken);

    const listRoute = createRoute({
        tags: ['Admin: orders'],
        security: [{ bearerAuth: [] }],
        middleware: [adminOnly] as const,
        method: 'get',
        path: '/admin/orders',
        summary: 'List orders with prints',
        description: [
            'The print queue. `status=open` is the work to do: paid and printing orders, the oldest paid first (so',
            'are `paid` and `printing` on their own). Without a status, every order that was paid for (including',
            'refunded ones), newest first. Orders with only files are not listed: they need nothing done.',
        ].join('\n'),
        request: { query: adminOrderListQuerySchema },
        responses: {
            200: {
                description: 'One page of orders.',
                content: { 'application/json': { schema: adminOrderListSchema } },
            },
            400: errorResponse('Invalid query parameters.'),
            ...adminAuthResponses,
        },
    });

    const getRoute = createRoute({
        tags: ['Admin: orders'],
        security: [{ bearerAuth: [] }],
        middleware: [adminOnly] as const,
        method: 'get',
        path: '/admin/orders/{id}',
        summary: 'Get an order with prints',
        description: 'The order with its lines, shipping address and shipment.',
        request: { params: idParams },
        responses: {
            200: orderResponse('The order.'),
            400: errorResponse('The id is not a UUID.'),
            ...adminAuthResponses,
            404: notFoundResponse,
        },
    });

    const statusRoute = createRoute({
        tags: ['Admin: orders'],
        security: [{ bearerAuth: [] }],
        middleware: [adminOnly] as const,
        method: 'post',
        path: '/admin/orders/{id}/status',
        summary: 'Move an order along the queue',
        description: [
            'paid → printing → shipped → delivered. Printing can be skipped. `shipped` needs the `carrier` and',
            '`trackingNumber`; sending it again for a shipped order corrects them. Asking for the status the order',
            'already has changes nothing. Nothing goes backwards.',
        ].join('\n'),
        request: {
            params: idParams,
            body: { required: true, content: { 'application/json': { schema: updateOrderStatusSchema } } },
        },
        responses: {
            200: orderResponse('The updated order.'),
            400: errorResponse('Invalid input.'),
            ...adminAuthResponses,
            404: notFoundResponse,
            409: errorResponse(
                "The order can't move to this status from the one it's in (e.g. it isn't paid), or it changed in the meantime.",
            ),
        },
    });

    return createRouter()
        .openapi(listRoute, async (c) => {
            return c.json(await deps.adminOrders.list(c.req.valid('query')), 200);
        })
        .openapi(getRoute, async (c) => {
            return c.json(await deps.adminOrders.get(c.req.valid('param').id), 200);
        })
        .openapi(statusRoute, async (c) => {
            const order = await deps.adminOrders.setStatus(c.req.valid('param').id, c.req.valid('json'));
            return c.json(order, 200);
        });
}
