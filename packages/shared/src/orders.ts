/**
 * An order's life. M3 sells files only: an order is `pending` until Stripe reports the payment, then
 * `paid` (the buyer owns the files) or `cancelled` (the payment failed, or checkout expired unpaid). `refunded`
 * is set when a paid order is refunded. Print orders (M4) add printing → shipped → delivered.
 */
export const ORDER_STATUSES = ['pending', 'paid', 'cancelled', 'refunded'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** What an order line is. Print lines (with material and colour) arrive in M4. */
export const ORDER_ITEM_TYPES = ['digital'] as const;
export type OrderItemType = (typeof ORDER_ITEM_TYPES)[number];

/** Orders are in euros only, for now. */
export const ORDER_CURRENCY = 'EUR';
