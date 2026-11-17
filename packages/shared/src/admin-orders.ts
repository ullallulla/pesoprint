import { z } from 'zod';

import { cartPrintOptionSchema } from './cart.ts';
import { ORDER_CURRENCY, ORDER_ITEM_TYPES, ORDER_STATUSES } from './orders.ts';
import { parcelSizeSchema, shippingAddressSchema } from './shipping.ts';

/**
 * The admin's order queue lists orders with prints. `open` is the work to do (paid and printing, oldest first);
 * no status is every order that was paid for, newest first. A single status shows only those.
 */
export const ADMIN_ORDER_FILTERS = ['open', ...ORDER_STATUSES] as const;
export const adminOrderFilterSchema = z.enum(ADMIN_ORDER_FILTERS);
export type AdminOrderFilter = z.infer<typeof adminOrderFilterSchema>;

export const adminOrderListQuerySchema = z.object({
    status: adminOrderFilterSchema.optional(),
    /** Matches part of the buyer's email or name, the tracking number, or the order id. */
    q: z.string().trim().min(1).max(100).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type AdminOrderListQuery = z.infer<typeof adminOrderListQuerySchema>;

/** Carriers suggested in the admin; any name is accepted while carriers aren't decided (see the plan). */
export const SUGGESTED_CARRIERS = ['Posti', 'Matkahuolto', 'DHL'] as const;

const carrierSchema = z.string().trim().min(1, 'Enter the carrier.').max(50);
const trackingNumberSchema = z
    .string()
    .trim()
    .min(1, 'Enter the tracking number.')
    .max(100)
    // Carriers' codes are letters, digits and dashes; spaces from copying are dropped.
    .transform((value) => value.replace(/\s+/g, ''))
    .pipe(z.string().regex(/^[A-Za-z0-9-]+$/, 'Use only letters, digits and dashes.'));

/**
 * Moves an order along the queue. `shipped` needs the carrier and tracking number; sending it again for a
 * shipped order corrects them.
 */
export const updateOrderStatusSchema = z
    .discriminatedUnion('status', [
        z.object({ status: z.literal('printing') }),
        z.object({ status: z.literal('shipped'), carrier: carrierSchema, trackingNumber: trackingNumberSchema }),
        z.object({ status: z.literal('delivered') }),
    ])
    .meta({ id: 'UpdateOrderStatus' });
export type UpdateOrderStatus = z.infer<typeof updateOrderStatusSchema>;

const timestampSchema = z.iso.datetime();

export const adminOrderSchema = z
    .object({
        id: z.uuid(),
        status: z.enum(ORDER_STATUSES),
        /** The buyer's email when ordering. */
        email: z.email(),
        /** `null` if the buyer's account has been deleted. */
        userId: z.string().nullable(),
        currency: z.literal(ORDER_CURRENCY),
        subtotalCents: z.int(),
        shippingCents: z.int(),
        parcelSize: parcelSizeSchema,
        totalCents: z.int(),
        /** Set once paid. */
        shippingAddress: shippingAddressSchema.nullable(),
        carrier: z.string().nullable(),
        trackingNumber: z.string().nullable(),
        createdAt: timestampSchema,
        paidAt: timestampSchema.nullable(),
        shippedAt: timestampSchema.nullable(),
        deliveredAt: timestampSchema.nullable(),
        items: z.array(
            z.object({
                productId: z.uuid(),
                type: z.enum(ORDER_ITEM_TYPES),
                /** As it was when bought. */
                title: z.string(),
                /** A print's material and colours, as chosen. `null` on file lines. */
                print: cartPrintOptionSchema.nullable(),
                quantity: z.int(),
                unitPriceCents: z.int(),
            }),
        ),
    })
    .meta({ id: 'AdminOrder' });
export type AdminOrder = z.infer<typeof adminOrderSchema>;

export const adminOrderListSchema = z
    .object({
        orders: z.array(adminOrderSchema),
        page: z.int(),
        pageSize: z.int(),
        total: z.int(),
    })
    .meta({ id: 'AdminOrderList' });
export type AdminOrderList = z.infer<typeof adminOrderListSchema>;
