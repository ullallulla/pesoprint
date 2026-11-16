import { z } from 'zod';

import { cartItemSchema, MAX_CART_ITEMS } from './cart.ts';
import { productFileFormatSchema } from './products.ts';
import { ORDER_CURRENCY, ORDER_ITEM_TYPES, ORDER_STATUSES } from './orders.ts';

/** Starts paying for the cart: the API prices it again, creates a pending order and a Stripe Checkout Session. */
export const checkoutRequestSchema = z
    .object({
        items: z.array(cartItemSchema).min(1).max(MAX_CART_ITEMS),
        /**
         * The buyer ticked the box agreeing that files are delivered right away, and that this ends their
         * 14-day right of withdrawal (EU rule for digital content). Required for an order with model files.
         */
        immediateDeliveryConsent: z.boolean(),
    })
    .meta({ id: 'CheckoutRequest' });
export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;

export const checkoutStartSchema = z
    .object({
        orderId: z.uuid(),
        /** Stripe's payment page. Send the buyer here. */
        paymentUrl: z.url(),
    })
    .meta({ id: 'CheckoutStart' });
export type CheckoutStart = z.infer<typeof checkoutStartSchema>;

export const orderFileSchema = z.object({
    id: z.uuid(),
    format: productFileFormatSchema,
    filename: z.string(),
    sizeBytes: z.int(),
});

/** An order as its buyer sees it. */
export const orderSchema = z
    .object({
        id: z.uuid(),
        status: z.enum(ORDER_STATUSES),
        currency: z.literal(ORDER_CURRENCY),
        subtotalCents: z.int(),
        taxCents: z.int(),
        totalCents: z.int(),
        vatRateBp: z.int(),
        createdAt: z.iso.datetime(),
        paidAt: z.iso.datetime().nullable(),
        items: z.array(
            z.object({
                productId: z.uuid(),
                type: z.enum(ORDER_ITEM_TYPES),
                /** As it was when bought. */
                title: z.string(),
                /** The product's current slug, for links. */
                slug: z.string(),
                unitPriceCents: z.int(),
                quantity: z.int(),
                /** The files to download: empty until the order is paid. */
                files: z.array(orderFileSchema),
            }),
        ),
    })
    .meta({ id: 'Order' });
export type Order = z.infer<typeof orderSchema>;
