import type { OrderStatus } from '@app/shared';

import { Badge } from '~/components/ui/badge';

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
    pending: 'Awaiting payment',
    paid: 'Paid',
    cancelled: 'Cancelled',
    refunded: 'Refunded',
    printing: 'Printing',
    shipped: 'Shipped',
    delivered: 'Delivered',
};

/** The work to do stands out; finished and dead orders recede. */
const VARIANTS: Record<OrderStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
    pending: 'outline',
    paid: 'default',
    printing: 'default',
    shipped: 'secondary',
    delivered: 'outline',
    cancelled: 'outline',
    refunded: 'destructive',
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
    return <Badge variant={VARIANTS[status]}>{ORDER_STATUS_LABELS[status]}</Badge>;
}

/**
 * How the admin refers to an order: its id's last 8 characters. Ids are uuidv7, so the first ones are a timestamp
 * and orders placed close together start alike. The API's search matches any part of the id.
 */
export function orderReference(id: string): string {
    return id.slice(-8);
}
