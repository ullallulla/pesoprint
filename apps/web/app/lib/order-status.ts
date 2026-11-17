import type { OrderStatus } from '@app/shared';

/** How a buyer reads an order's status. A paid order with prints is still waiting for them. */
export function buyerStatusLabel(order: { status: OrderStatus; parcelSize: unknown }): string {
    switch (order.status) {
        case 'pending':
            return 'Awaiting payment';
        case 'paid':
            return order.parcelSize ? 'Waiting to be printed' : 'Paid';
        case 'printing':
            return 'Being printed';
        case 'shipped':
            return 'On its way';
        case 'delivered':
            return 'Delivered';
        case 'refunded':
            return 'Refunded';
        case 'cancelled':
            return 'Cancelled';
    }
}
