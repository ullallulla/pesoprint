import { z } from 'zod';

import { catalogImageSchema } from './catalog.ts';
import { licenseSchema } from './licenses.ts';
import { ORDER_CURRENCY, ORDER_ITEM_TYPES, type OrderItemType } from './orders.ts';
import { parcelSizeSchema } from './shipping.ts';

/**
 * The cart lives in the visitor's browser (a cookie) and holds only what to buy, never prices: the API
 * prices it on every view with `POST /api/cart/quote`, and again when the order is created.
 */

/** Most cart lines allowed. Few enough that the cart cookie stays under the browser's 4 KB limit. */
export const MAX_CART_ITEMS = 25;
/** Print lines take more room in the cookie (a material, a colour and a quantity), so fewer of them fit. */
export const MAX_PRINT_LINES = 10;
/** Most copies of one print (in one material and colour) per order. */
export const MAX_PRINT_QUANTITY = 10;

export const digitalCartItemSchema = z.object({
    productId: z.uuid(),
    /** The model's file. */
    type: z.literal('digital'),
});

export const printCartItemSchema = z.object({
    productId: z.uuid(),
    /** A printed copy. */
    type: z.literal('print'),
    materialId: z.uuid(),
    /** One of the model's colour options. `null` when the model has none: it comes in the colours shown. */
    colourOptionId: z.uuid().nullable(),
    quantity: z.int().min(1).max(MAX_PRINT_QUANTITY),
});

export const cartItemSchema = z
    .discriminatedUnion('type', [digitalCartItemSchema, printCartItemSchema])
    .meta({ id: 'CartItem' });
export type CartItem = z.infer<typeof cartItemSchema>;
export type PrintCartItem = z.infer<typeof printCartItemSchema>;

/** Identifies a cart line: the same model's file, or the same model printed in the same material and colour. */
export function cartItemKey(item: {
    type: OrderItemType;
    productId: string;
    materialId?: string | null;
    colourOptionId?: string | null;
}): string {
    return item.type === 'print'
        ? `print:${item.productId}:${item.materialId}:${item.colourOptionId ?? ''}`
        : `digital:${item.productId}`;
}

export const cartItemsSchema = z
    .array(cartItemSchema)
    .max(MAX_CART_ITEMS)
    .refine((items) => items.filter((item) => item.type === 'print').length <= MAX_PRINT_LINES, {
        message: `At most ${MAX_PRINT_LINES} different prints.`,
    });

export const cartQuoteRequestSchema = z.object({ items: cartItemsSchema }).meta({ id: 'CartQuoteRequest' });
export type CartQuoteRequest = z.infer<typeof cartQuoteRequestSchema>;

/**
 * Why an item can't be bought: no longer on sale (unpublished, removed, the file now free, or no longer
 * printed), already bought (files), or its material or colour is no longer offered or out of stock (prints).
 */
export const CART_REMOVAL_REASONS = ['unavailable', 'owned', 'option_unavailable'] as const;
export type CartRemovalReason = (typeof CART_REMOVAL_REASONS)[number];

/** What a print is printed in: on cart and order lines. */
export const cartPrintOptionSchema = z
    .object({
        materialName: z.string(),
        /** e.g. "Black / Signal red". `null`: printed in the colours shown. */
        colourName: z.string().nullable(),
        /** `#rrggbb` swatches, in order. Empty when `colourName` is `null`. */
        colours: z.array(z.object({ name: z.string(), hex: z.string() })),
    })
    .meta({ id: 'PrintChoice' });
export type PrintChoice = z.infer<typeof cartPrintOptionSchema>;

export const cartLineSchema = z
    .object({
        productId: z.uuid(),
        type: z.enum(ORDER_ITEM_TYPES),
        /** Set on print lines: with the product and colour option, it identifies the line (see `cartItemKey`). */
        materialId: z.uuid().nullable(),
        /** The colour option of a print line, `null` when the model has none (and on file lines). */
        colourOptionId: z.uuid().nullable(),
        slug: z.string(),
        title: z.string(),
        cover: catalogImageSchema.nullable(),
        /** The file's licence. `null` on print lines. */
        license: licenseSchema.nullable(),
        /** Material and colour of a print line. `null` on file lines. */
        print: cartPrintOptionSchema.nullable(),
        /** Current price of one, in euro cents, VAT included. */
        unitPriceCents: z.int().positive(),
        /** Always 1 for a file. */
        quantity: z.int().positive(),
    })
    .meta({ id: 'CartLine' });
export type CartLine = z.infer<typeof cartLineSchema>;

export const cartQuoteSchema = z
    .object({
        /** The items that can be bought, in the order they were sent. The same item sent twice is one line. */
        lines: z.array(cartLineSchema),
        /** Items that were sent but can't be bought. The cart should drop them and tell the visitor why. */
        removed: z.array(
            z.object({
                productId: z.uuid(),
                type: z.enum(ORDER_ITEM_TYPES),
                materialId: z.uuid().nullable(),
                colourOptionId: z.uuid().nullable(),
                /** `null` when the product no longer exists, or isn't public. */
                title: z.string().nullable(),
                /** e.g. "PLA, Ocean blue", when a print's material or colour is the problem. */
                option: z.string().nullable(),
                reason: z.enum(CART_REMOVAL_REASONS),
            }),
        ),
        currency: z.literal(ORDER_CURRENCY),
        subtotalCents: z.int().nonnegative(),
        /**
         * The parcel the prints ship in: the largest among them. `null` without prints: files need no
         * shipping.
         */
        parcelSize: parcelSizeSchema.nullable(),
        /** One parcel per order. 0 without prints. */
        shippingCents: z.int().nonnegative(),
        /** Subtotal plus shipping. */
        totalCents: z.int().nonnegative(),
        /** The VAT contained in the total. */
        taxCents: z.int().nonnegative(),
        vatCountry: z.string().length(2),
        vatRateBp: z.int().nonnegative(),
    })
    .meta({ id: 'CartQuote' });
export type CartQuote = z.infer<typeof cartQuoteSchema>;
