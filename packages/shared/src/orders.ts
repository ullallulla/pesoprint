/**
 * An order's life. An order is `pending` until Stripe reports the payment, then `paid` (the buyer owns the
 * files) or `cancelled` (the payment failed, or checkout expired unpaid). `refunded` is set when a paid order
 * is refunded. An order with prints then goes through the admin's queue: `printing` → `shipped` (with a
 * carrier and tracking number) → `delivered`.
 */
// The database enum is built from this tuple, so changing it needs a migration.
export const ORDER_STATUSES = ['pending', 'paid', 'cancelled', 'refunded', 'printing', 'shipped', 'delivered'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** The statuses of an order that has been paid for (and not refunded): its files are the buyer's. */
export const PAID_ORDER_STATUSES = ['paid', 'printing', 'shipped', 'delivered'] as const satisfies OrderStatus[];
export type PaidOrderStatus = (typeof PAID_ORDER_STATUSES)[number];

export function isPaidStatus(status: OrderStatus): status is PaidOrderStatus {
    return (PAID_ORDER_STATUSES as readonly OrderStatus[]).includes(status);
}

/** The steps a paid order with prints goes through, in order. */
export const FULFILMENT_STATUSES = ['printing', 'shipped', 'delivered'] as const satisfies OrderStatus[];
export type FulfilmentStatus = (typeof FULFILMENT_STATUSES)[number];

/**
 * Which statuses an order with prints can be moved to from each status. Printing can be skipped (prints made
 * ahead of time); `shipped` → `shipped` corrects the carrier or tracking number. Nothing goes backwards.
 */
const FULFILMENT_MOVES: Record<FulfilmentStatus, readonly OrderStatus[]> = {
    printing: ['paid'],
    shipped: ['paid', 'printing', 'shipped'],
    delivered: ['shipped'],
};

export function canMoveTo(from: OrderStatus, to: FulfilmentStatus): boolean {
    return FULFILMENT_MOVES[to].includes(from);
}

/** What an order is waiting for in the admin's queue: the next step, or `null` once delivered (or not paid). */
export function nextFulfilmentStatus(status: OrderStatus): FulfilmentStatus | null {
    if (status === 'paid') return 'printing';
    if (status === 'printing') return 'shipped';
    if (status === 'shipped') return 'delivered';
    return null;
}

/** What an order line is: the model's file, or a printed copy in a material and colour. */
export const ORDER_ITEM_TYPES = ['digital', 'print'] as const;
export type OrderItemType = (typeof ORDER_ITEM_TYPES)[number];

/** Orders are in euros only, for now. */
export const ORDER_CURRENCY = 'EUR';
