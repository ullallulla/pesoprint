import {
    canMoveTo,
    ORDER_CURRENCY,
    PAID_ORDER_STATUSES,
    type AdminOrder,
    type AdminOrderList,
    type AdminOrderListQuery,
    type OrderStatus,
    type UpdateOrderStatus,
} from '@app/shared';
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, or, sql, type SQL } from 'drizzle-orm';

import type { Database } from '../db/client.ts';
import { orderItems, orders, type Order } from '../db/schema.ts';
import { conflict, notFound } from '../lib/errors.ts';

export interface AdminOrdersService {
    /** One page of orders with prints, filtered by status and text. */
    list(query: AdminOrderListQuery): Promise<AdminOrderList>;
    /** One order with prints. */
    get(orderId: string): Promise<AdminOrder>;
    /**
     * Moves an order along the queue (see `canMoveTo`). Asking for the status it already has changes nothing,
     * except that `shipped` replaces the carrier and tracking number. Refuses a move the order isn't ready for,
     * or one that raced another change (409).
     */
    setStatus(orderId: string, change: UpdateOrderStatus): Promise<AdminOrder>;
}

export interface AdminOrdersOptions {
    now?: () => Date;
}

/** Escapes `%`, `_` and `\` so user input matches literally inside an ILIKE pattern. */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&');

const STATUS_NAMES: Record<OrderStatus, string> = {
    pending: 'waiting for payment',
    paid: 'paid',
    cancelled: 'cancelled',
    refunded: 'refunded',
    printing: 'printing',
    shipped: 'shipped',
    delivered: 'delivered',
};

const hasPrints = isNotNull(orders.parcelSize);

export function createAdminOrdersService(db: Database, { now = () => new Date() }: AdminOrdersOptions = {}) {
    async function withItems(rows: Order[]): Promise<AdminOrder[]> {
        if (rows.length === 0) return [];
        const items = await db
            .select()
            .from(orderItems)
            .where(
                inArray(
                    orderItems.orderId,
                    rows.map((row) => row.id),
                ),
            )
            .orderBy(asc(orderItems.id));

        return rows.map((order) => ({
            id: order.id,
            status: order.status,
            email: order.email,
            userId: order.userId,
            currency: ORDER_CURRENCY,
            subtotalCents: order.subtotalCents,
            shippingCents: order.shippingCents,
            // Every order here has prints (`hasPrints`).
            parcelSize: order.parcelSize!,
            totalCents: order.totalCents,
            shippingAddress: order.shippingAddress,
            carrier: order.carrier,
            trackingNumber: order.trackingNumber,
            createdAt: order.createdAt.toISOString(),
            paidAt: order.paidAt?.toISOString() ?? null,
            shippedAt: order.shippedAt?.toISOString() ?? null,
            deliveredAt: order.deliveredAt?.toISOString() ?? null,
            items: items
                .filter((item) => item.orderId === order.id)
                .map((item) => ({
                    productId: item.productId,
                    type: item.type,
                    title: item.titleSnapshot,
                    print: item.printSnapshot,
                    quantity: item.quantity,
                    unitPriceCents: item.unitPriceCents,
                })),
        }));
    }

    async function find(orderId: string): Promise<Order> {
        const [order] = await db
            .select()
            .from(orders)
            .where(and(eq(orders.id, orderId), hasPrints));
        if (!order) throw notFound('No order with prints with this id.');
        return order;
    }

    const service: AdminOrdersService = {
        async list({ status, q, page, pageSize }) {
            const conditions: SQL[] = [hasPrints];
            if (status === 'open') conditions.push(inArray(orders.status, ['paid', 'printing']));
            else if (status) conditions.push(eq(orders.status, status));
            else conditions.push(inArray(orders.status, [...PAID_ORDER_STATUSES, 'refunded']));
            if (q) {
                const pattern = `%${escapeLike(q)}%`;
                conditions.push(
                    or(
                        ilike(orders.email, pattern),
                        ilike(sql`${orders.shippingAddress}->>'name'`, pattern),
                        ilike(orders.trackingNumber, pattern),
                        ilike(sql`${orders.id}::text`, pattern),
                    )!,
                );
            }
            const where = and(...conditions);

            // The work to do is done first come, first served; everything else is newest first (unpaid ones by
            // when they were placed).
            const queue = status === 'open' || status === 'paid' || status === 'printing';
            const rows = await db
                .select()
                .from(orders)
                .where(where)
                .orderBy(
                    ...(queue
                        ? [asc(orders.paidAt), asc(orders.id)]
                        : [sql`${orders.paidAt} DESC NULLS LAST`, desc(orders.createdAt), desc(orders.id)]),
                )
                .limit(pageSize)
                .offset((page - 1) * pageSize);
            const [total] = await db.select({ value: count() }).from(orders).where(where);

            return { orders: await withItems(rows), page, pageSize, total: total?.value ?? 0 };
        },

        async get(orderId) {
            return (await withItems([await find(orderId)]))[0]!;
        },

        async setStatus(orderId, change) {
            const order = await find(orderId);
            if (order.status === change.status && change.status !== 'shipped') return service.get(orderId);
            if (!canMoveTo(order.status, change.status)) {
                throw conflict(
                    `This order is ${STATUS_NAMES[order.status]}, so it can't be marked ${STATUS_NAMES[change.status]}.`,
                );
            }

            const at = now();
            const [updated] = await db
                .update(orders)
                .set(
                    change.status === 'shipped'
                        ? {
                              status: 'shipped',
                              carrier: change.carrier,
                              trackingNumber: change.trackingNumber,
                              // A correction keeps the day it was shipped.
                              shippedAt: order.shippedAt ?? at,
                          }
                        : change.status === 'delivered'
                          ? { status: 'delivered', deliveredAt: at }
                          : { status: change.status },
                )
                // Only from the status it was read in: two admins (or two clicks) can't both move it.
                .where(and(eq(orders.id, orderId), eq(orders.status, order.status)))
                .returning({ id: orders.id });
            if (!updated) throw conflict('The order changed in the meantime. Reload it and try again.');
            return service.get(orderId);
        },
    };
    return service;
}
