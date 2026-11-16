import { cartQuoteRequestSchema, cartQuoteSchema, MAX_CART_ITEMS, MAX_PRINT_LINES } from '@app/shared';
import { createRoute } from '@hono/zod-openapi';

import type { VerifySessionToken } from '../lib/auth.ts';
import { errorResponse } from '../lib/openapi.ts';
import { createRouter } from '../lib/router.ts';
import { optionalAuth } from '../middleware/auth.ts';
import type { CartService } from '../services/cart.ts';

export interface CartDeps {
    verifySessionToken: VerifySessionToken;
    cart: CartService;
}

export function cartRoutes(deps: CartDeps) {
    const quoteRoute = createRoute({
        tags: ['Cart'],
        // Optional: signed in, models you already bought are left out.
        security: [{ bearerAuth: [] }],
        middleware: [optionalAuth(deps.verifySessionToken)] as const,
        method: 'post',
        path: '/cart/quote',
        summary: 'Price a cart',
        description: [
            "The cart is kept by the browser and holds no prices. This prices it from today's catalogue: the",
            'items that can be bought, the shipping, the total and the VAT it contains (prices include VAT).',
            'Items that are no longer for sale, prints whose material or colour option is no longer offered or',
            'out of stock, and files the signed-in caller already owns are listed under `removed` instead.',
            '',
            "Prints ship in one parcel, the size of the largest print's parcel; files need no shipping. The same",
            "item twice is one line (a print's quantities are added up).",
            `At most ${MAX_CART_ITEMS} lines, ${MAX_PRINT_LINES} of them prints.`,
        ].join('\n'),
        request: {
            body: { required: true, content: { 'application/json': { schema: cartQuoteRequestSchema } } },
        },
        responses: {
            200: { description: 'The priced cart.', content: { 'application/json': { schema: cartQuoteSchema } } },
            400: errorResponse('Invalid items, or too many.'),
            401: errorResponse('A session token was sent, but it is invalid or has expired.'),
        },
    });

    return createRouter().openapi(quoteRoute, async (c) => {
        const quote = await deps.cart.quote(c.req.valid('json').items, c.get('auth') ?? undefined);
        // Depends on the caller (what they own) and on today's prices.
        c.header('Cache-Control', 'no-store');
        return c.json(quote, 200);
    });
}
