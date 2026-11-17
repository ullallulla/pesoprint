import { z } from 'zod';

import { cartItemSchema, cartPrintOptionSchema, MAX_CART_ITEMS } from './cart.ts';
import { productFileFormatSchema } from './products.ts';
import { ORDER_CURRENCY, ORDER_ITEM_TYPES, ORDER_STATUSES } from './orders.ts';
import { parcelSizeSchema, shippingAddressSchema } from './shipping.ts';

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
        /** 0 without prints. */
        shippingCents: z.int(),
        /** The parcel the prints ship in. `null` without prints. */
        parcelSize: parcelSizeSchema.nullable(),
        /** Subtotal plus shipping. */
        totalCents: z.int(),
        taxCents: z.int(),
        vatRateBp: z.int(),
        /** Where the prints go. Set once paid; `null` before, and for orders without prints. */
        shippingAddress: shippingAddressSchema.nullable(),
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
                /** A print's material and colours, as chosen. `null` on file lines. */
                print: cartPrintOptionSchema.nullable(),
                unitPriceCents: z.int(),
                quantity: z.int(),
                /** The files to download: empty until the order is paid, and on print lines. */
                files: z.array(orderFileSchema),
            }),
        ),
    })
    .meta({ id: 'Order' });
export type Order = z.infer<typeof orderSchema>;
