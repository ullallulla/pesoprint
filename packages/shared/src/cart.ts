import { z } from 'zod';

import { catalogImageSchema } from './catalog.ts';
import { licenseSchema } from './licenses.ts';
import { ORDER_CURRENCY, ORDER_ITEM_TYPES } from './orders.ts';

/**
 * The cart lives in the visitor's browser (a cookie) and holds only what to buy, never prices: the API
 * prices it on every view with `POST /api/cart/quote`, and again when the order is created.
 */

/** More than anyone buys at once, and few enough that the cart cookie stays well under the 4 KB limit. */
export const MAX_CART_ITEMS = 25;

export const cartItemSchema = z
    .object({
        productId: z.uuid(),
        /** `digital`: the model's file. Print items (with material and colour) arrive in M4. */
        type: z.enum(ORDER_ITEM_TYPES),
    })
    .meta({ id: 'CartItem' });
export type CartItem = z.infer<typeof cartItemSchema>;

export const cartQuoteRequestSchema = z
    .object({ items: z.array(cartItemSchema).max(MAX_CART_ITEMS) })
    .meta({ id: 'CartQuoteRequest' });
export type CartQuoteRequest = z.infer<typeof cartQuoteRequestSchema>;

/** Why an item can't be bought: no longer on sale (unpublished, removed, or now free), or already bought. */
export const CART_REMOVAL_REASONS = ['unavailable', 'owned'] as const;
export type CartRemovalReason = (typeof CART_REMOVAL_REASONS)[number];

export const cartLineSchema = z
    .object({
        productId: z.uuid(),
        type: z.enum(ORDER_ITEM_TYPES),
        slug: z.string(),
        title: z.string(),
        cover: catalogImageSchema.nullable(),
        license: licenseSchema,
        /** Current price in euro cents, VAT included. */
        unitPriceCents: z.int().positive(),
        quantity: z.int().positive(),
    })
    .meta({ id: 'CartLine' });
export type CartLine = z.infer<typeof cartLineSchema>;

export const cartQuoteSchema = z
    .object({
        /** The items that can be bought, in the order they were sent, without duplicates. */
        lines: z.array(cartLineSchema),
        /** Items that were sent but can't be bought. The cart should drop them and tell the visitor why. */
        removed: z.array(
            z.object({
                productId: z.uuid(),
                type: z.enum(ORDER_ITEM_TYPES),
                /** `null` when the product no longer exists. */
                title: z.string().nullable(),
                reason: z.enum(CART_REMOVAL_REASONS),
            }),
        ),
        currency: z.literal(ORDER_CURRENCY),
        subtotalCents: z.int().nonnegative(),
        /** Equal to the subtotal until print items bring shipping (M4). */
        totalCents: z.int().nonnegative(),
        /** The VAT contained in the total. */
        taxCents: z.int().nonnegative(),
        vatCountry: z.string().length(2),
        vatRateBp: z.int().nonnegative(),
    })
    .meta({ id: 'CartQuote' });
export type CartQuote = z.infer<typeof cartQuoteSchema>;
