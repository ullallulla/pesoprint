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
import type { RefundsService } from '../services/refunds.ts';

export interface AdminOrderDeps {
    verifySessionToken: VerifySessionToken;
    adminOrders: AdminOrdersService;
    refunds: RefundsService;
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

    const refundRoute = createRoute({
        tags: ['Admin: orders'],
        security: [{ bearerAuth: [] }],
        middleware: [adminOnly] as const,
        method: 'post',
        path: '/admin/orders/{id}/refund',
        summary: 'Refund an order',
        description: [
            'Refunds the whole order (what is left of it after any partial refund in Stripe) to the payment it was',
            'paid with. Only orders with prints, like the rest of this API; refund files-only orders in Stripe’s',
            'dashboard, and the webhook records it. The order becomes `refunded`, its files leave the buyer’s',
            'library, and the buyer gets an email. Refunding a refunded order changes nothing. Stripe sometimes takes',
            'days to finish a refund; if it fails, Stripe reports it and the error is logged.',
        ].join('\n'),
        request: { params: idParams },
        responses: {
            200: orderResponse('The refunded order.'),
            400: errorResponse('The id is not a UUID.'),
            ...adminAuthResponses,
            404: notFoundResponse,
            409: errorResponse("The order wasn't paid."),
            502: errorResponse('Stripe refused the refund (its reason is in the message) or could not be reached.'),
            503: errorResponse("Payments aren't set up on this server."),
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
        })
        .openapi(refundRoute, async (c) => {
            const { id } = c.req.valid('param');
            // Like the rest of the admin's orders: those with prints. Files-only orders are refunded in Stripe.
            await deps.adminOrders.get(id);
            await deps.refunds.refund(id);
            return c.json(await deps.adminOrders.get(id), 200);
        });
}
