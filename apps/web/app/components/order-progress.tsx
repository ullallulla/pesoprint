import type { OrderStatus } from '@app/shared';
import { cn } from 'cn';
import { Check } from 'lucide-react';

import { formatDate } from '~/lib/format';

const STEPS = [
    { status: 'paid', label: 'Ordered' },
    { status: 'printing', label: 'Printing' },
    { status: 'shipped', label: 'Shipped' },
    { status: 'delivered', label: 'Delivered' },
] as const satisfies readonly { status: OrderStatus; label: string }[];

/**
 * Where a print order has got to: ordered → printing → shipped → delivered. Only for paid orders with prints;
 * a refunded one has no progress to show.
 */
export function OrderProgress({ status, className }: { status: OrderStatus; className?: string }) {
    const current = STEPS.findIndex((step) => step.status === status);
    if (current === -1) return null;

    return (
        <ol aria-label='Order progress' className={cn('grid grid-cols-4 gap-2 text-xs', className)}>
            {STEPS.map((step, index) => {
                const done = index <= current;
                return (
                    <li
                        key={step.status}
                        aria-current={index === current ? 'step' : undefined}
                        className='flex flex-col gap-1.5'
                    >
                        <span className={cn('h-1.5 rounded-full', done ? 'bg-primary' : 'bg-muted')} aria-hidden />
                        <span
                            className={cn(
                                'flex items-center gap-1',
                                index === current ? 'font-medium text-foreground' : 'text-muted-foreground',
                            )}
                        >
                            {index < current && <Check className='size-3' aria-hidden />}
                            {step.label}
                            {/* The bar's colour isn't announced; say which steps are done. */}
                            {index < current && <span className='sr-only'> (done)</span>}
                        </span>
                    </li>
                );
            })}
        </ol>
    );
}

interface ShipmentProps {
    carrier: string | null;
    trackingNumber: string | null;
    shippedAt: string | null;
    deliveredAt: string | null;
    className?: string;
}

/** The parcel's carrier and tracking number, once it's shipped. Nothing before then. */
export function Shipment({ carrier, trackingNumber, shippedAt, deliveredAt, className }: ShipmentProps) {
    if (!trackingNumber) return null;
    return (
        <dl className={cn('grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm', className)}>
            <dt className='text-muted-foreground'>Tracking</dt>
            <dd>
                {carrier} <span className='font-mono select-all'>{trackingNumber}</span>
            </dd>
            {shippedAt && (
                <>
                    <dt className='text-muted-foreground'>Shipped</dt>
                    <dd>
                        <time dateTime={shippedAt}>{formatDate(shippedAt)}</time>
                    </dd>
                </>
            )}
            {deliveredAt && (
                <>
                    <dt className='text-muted-foreground'>Delivered</dt>
                    <dd>
                        <time dateTime={deliveredAt}>{formatDate(deliveredAt)}</time>
                    </dd>
                </>
            )}
        </dl>
    );
}
