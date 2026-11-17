import {
    adminOrderSchema,
    PARCEL_SIZE_NAMES,
    SUGGESTED_CARRIERS,
    type AdminOrder,
    type UpdateOrderStatus,
} from '@app/shared';
import { ArrowLeft, PackageCheck, Printer, Truck } from 'lucide-react';
import { useId } from 'react';
import { data, Form, Link, useActionData, useNavigation } from 'react-router';
import { z } from 'zod';

import { confirmSubmit, Field, FormStatus } from '~/components/admin/form';
import { orderReference, OrderStatusBadge } from '~/components/admin/order-status';
import { ColourSwatch } from '~/components/colour-swatch';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { fieldErrors, formValue, parseShipmentForm } from '~/lib/admin-forms';
import { adminApi, invalid, runAction, type ActionResult } from '~/lib/admin.server';
import { formatDate, formatPrice } from '~/lib/format';
import { printOptionText } from '~/lib/print-option';

import type { Route } from './+types/order';

export const meta: Route.MetaFunction = ({ loaderData }) => [
    { title: `Order ${loaderData ? orderReference(loaderData.order.id) : ''} – Admin – Pesoprint` },
    { name: 'robots', content: 'noindex' },
];

export async function loader(args: Route.LoaderArgs) {
    if (!z.uuid().safeParse(args.params.id).success) throw data('Order not found', { status: 404 });
    const order = await adminApi(args, `/api/admin/orders/${args.params.id}`, adminOrderSchema);
    return { order };
}

const DONE_MESSAGES: Record<UpdateOrderStatus['status'], string> = {
    printing: 'Marked as printing.',
    shipped: 'Shipment saved.',
    delivered: 'Marked as delivered.',
};

export async function action(args: Route.ActionArgs): Promise<ActionResult> {
    const form = await args.request.formData();
    const intent = formValue(form, 'intent');

    let change: UpdateOrderStatus;
    if (intent === 'shipped') {
        const parsed = parseShipmentForm(form);
        if (!parsed.ok) return invalid(parsed.issues);
        change = parsed.data;
    } else if (intent === 'printing' || intent === 'delivered') {
        change = { status: intent };
    } else {
        return invalid([], 'Unknown action.');
    }

    return runAction(async () => {
        await adminApi(args, `/api/admin/orders/${encodeURIComponent(args.params.id)}/status`, adminOrderSchema, {
            method: 'POST',
            json: change,
        });
        return DONE_MESSAGES[change.status];
    });
}

export default function AdminOrderPage({ loaderData }: Route.ComponentProps) {
    const { order } = loaderData;
    const result = useActionData<typeof action>();

    return (
        <main className='flex flex-col gap-8'>
            <div className='flex flex-col gap-2'>
                <Link
                    to='/admin/orders'
                    className='flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground'
                >
                    <ArrowLeft className='size-4' aria-hidden />
                    Orders
                </Link>
                <div className='flex flex-wrap items-center gap-3'>
                    <h1 className='font-mono text-3xl font-bold tracking-tight'>{orderReference(order.id)}</h1>
                    <OrderStatusBadge status={order.status} />
                </div>
                <p className='font-mono text-xs text-muted-foreground'>{order.id}</p>
            </div>

            <div className='grid gap-8 lg:grid-cols-[1fr_22rem]'>
                <div className='flex flex-col gap-8'>
                    <NextStep order={order} result={result} />
                    <Lines order={order} />
                </div>
                <div className='flex flex-col gap-6'>
                    <ShipTo order={order} />
                    <Timeline order={order} />
                </div>
            </div>
        </main>
    );
}

/** What to do with the order now: one main action, and fixing the shipment once it's sent. */
function NextStep({ order, result }: { order: AdminOrder; result: ActionResult | undefined }) {
    const busy = useNavigation().state === 'submitting';

    return (
        <section aria-labelledby='next-heading' className='flex flex-col gap-4 rounded-lg border p-4'>
            <h2 id='next-heading' className='font-semibold'>
                Next step
            </h2>

            {order.status === 'paid' && (
                <>
                    <p className='text-sm text-muted-foreground'>
                        Paid and waiting to be printed. Already printed? Enter the shipment below.
                    </p>
                    <Form method='post'>
                        <Button type='submit' name='intent' value='printing' disabled={busy}>
                            <Printer aria-hidden />
                            Start printing
                        </Button>
                    </Form>
                    <ShipmentForm order={order} result={result} busy={busy} />
                </>
            )}

            {order.status === 'printing' && (
                <>
                    <p className='text-sm text-muted-foreground'>
                        When the parcel is handed to the carrier, enter its tracking number. The buyer sees it on their
                        order.
                    </p>
                    <ShipmentForm order={order} result={result} busy={busy} />
                </>
            )}

            {order.status === 'shipped' && (
                <>
                    <p className='text-sm text-muted-foreground'>
                        On its way. Mark it delivered once the carrier shows it was collected: the buyer&apos;s 14-day
                        right of withdrawal starts then.
                    </p>
                    <Form method='post' onSubmit={confirmSubmit('Mark this order as delivered? This can’t be undone.')}>
                        <Button type='submit' name='intent' value='delivered' disabled={busy}>
                            <PackageCheck aria-hidden />
                            Mark as delivered
                        </Button>
                    </Form>
                    <details className='text-sm'>
                        <summary className='cursor-pointer text-muted-foreground hover:text-foreground'>
                            Correct the carrier or tracking number
                        </summary>
                        <ShipmentForm order={order} result={result} busy={busy} className='mt-4' />
                    </details>
                </>
            )}

            {order.status === 'delivered' && (
                <p className='text-sm text-muted-foreground'>Delivered. Nothing more to do.</p>
            )}
            {order.status === 'refunded' && (
                <p className='text-sm text-muted-foreground'>Refunded. Nothing to print or ship.</p>
            )}
            {(order.status === 'pending' || order.status === 'cancelled') && (
                <p className='text-sm text-muted-foreground'>Not paid. Nothing to print or ship.</p>
            )}

            <FormStatus result={result} fields={['carrier', 'trackingNumber']} />
        </section>
    );
}

function ShipmentForm({
    order,
    result,
    busy,
    className,
}: {
    order: AdminOrder;
    result: ActionResult | undefined;
    busy: boolean;
    className?: string;
}) {
    const errors = fieldErrors(result && !result.ok ? result.issues : undefined);
    const carriersId = useId();
    const correcting = order.status === 'shipped';

    return (
        <Form method='post' className={className}>
            <input type='hidden' name='intent' value='shipped' />
            <div className='flex flex-wrap items-start gap-3'>
                <Field label='Carrier' name='carrier' error={errors.carrier} className='w-40'>
                    {(control) => (
                        <>
                            <Input {...control} list={carriersId} defaultValue={order.carrier ?? ''} required />
                            <datalist id={carriersId}>
                                {SUGGESTED_CARRIERS.map((carrier) => (
                                    <option key={carrier} value={carrier}>
                                        {carrier}
                                    </option>
                                ))}
                            </datalist>
                        </>
                    )}
                </Field>
                <Field
                    label='Tracking number'
                    name='trackingNumber'
                    error={errors.trackingNumber}
                    className='min-w-56 flex-1'
                >
                    {(control) => (
                        <Input
                            {...control}
                            defaultValue={order.trackingNumber ?? ''}
                            autoComplete='off'
                            spellCheck={false}
                            className='font-mono'
                            required
                        />
                    )}
                </Field>
                <Button type='submit' variant={correcting ? 'outline' : 'default'} disabled={busy} className='mt-5.5'>
                    <Truck aria-hidden />
                    {correcting ? 'Save shipment' : 'Mark as shipped'}
                </Button>
            </div>
        </Form>
    );
}

function Lines({ order }: { order: AdminOrder }) {
    return (
        <section aria-labelledby='lines-heading' className='flex flex-col gap-3'>
            <h2 id='lines-heading' className='font-semibold'>
                What was ordered
            </h2>
            <ul className='divide-y rounded-lg border'>
                {order.items.map((item, index) => (
                    <li key={index} className='flex items-start justify-between gap-4 p-4'>
                        <div className='flex flex-col gap-1'>
                            <p className='font-medium'>
                                {item.quantity} × {item.title}
                            </p>
                            {item.print ? (
                                <p className='flex items-center gap-1.5 text-sm text-muted-foreground'>
                                    {item.print.colours.length > 0 && (
                                        <ColourSwatch colours={item.print.colours} className='size-3' />
                                    )}
                                    Print · {printOptionText(item.print)}
                                </p>
                            ) : (
                                <p className='text-sm text-muted-foreground'>File, downloaded by the buyer</p>
                            )}
                        </div>
                        <span className='tabular-nums'>{formatPrice(item.unitPriceCents * item.quantity)}</span>
                    </li>
                ))}
            </ul>
            <dl className='grid grid-cols-[1fr_auto] gap-y-1 text-sm'>
                <dt className='text-muted-foreground'>Shipping ({PARCEL_SIZE_NAMES[order.parcelSize]} parcel)</dt>
                <dd className='text-right text-muted-foreground tabular-nums'>{formatPrice(order.shippingCents)}</dd>
                <dt className='font-semibold'>Total</dt>
                <dd className='text-right font-semibold tabular-nums'>{formatPrice(order.totalCents)}</dd>
            </dl>
        </section>
    );
}

function ShipTo({ order }: { order: AdminOrder }) {
    const address = order.shippingAddress;
    return (
        <section aria-labelledby='ship-to-heading' className='flex flex-col gap-2 rounded-lg border p-4 text-sm'>
            <h2 id='ship-to-heading' className='font-semibold'>
                Ship to
            </h2>
            {address ? (
                <address className='not-italic'>
                    {address.name}
                    <br />
                    {address.line1}
                    {address.line2 && (
                        <>
                            <br />
                            {address.line2}
                        </>
                    )}
                    <br />
                    {address.postalCode} {address.city}
                    <br />
                    {address.country}
                </address>
            ) : (
                <p className='text-muted-foreground'>No address: the order wasn&apos;t paid.</p>
            )}
            <dl className='grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted-foreground'>
                {address?.phone && (
                    <>
                        <dt>Phone</dt>
                        <dd>
                            <a href={`tel:${address.phone}`} className='hover:text-foreground hover:underline'>
                                {address.phone}
                            </a>
                        </dd>
                    </>
                )}
                <dt>Email</dt>
                <dd className='break-all'>
                    <a href={`mailto:${order.email}`} className='hover:text-foreground hover:underline'>
                        {order.email}
                    </a>
                </dd>
            </dl>
        </section>
    );
}

function Timeline({ order }: { order: AdminOrder }) {
    const steps = [
        { label: 'Placed', at: order.createdAt },
        { label: 'Paid', at: order.paidAt },
        { label: 'Shipped', at: order.shippedAt },
        { label: 'Delivered', at: order.deliveredAt },
    ];
    return (
        <section aria-labelledby='timeline-heading' className='flex flex-col gap-2 rounded-lg border p-4 text-sm'>
            <h2 id='timeline-heading' className='font-semibold'>
                Timeline
            </h2>
            <dl className='grid grid-cols-[auto_1fr] gap-x-3 gap-y-1'>
                {steps.map((step) => (
                    <div key={step.label} className='contents'>
                        <dt className='text-muted-foreground'>{step.label}</dt>
                        <dd>{step.at ? <time dateTime={step.at}>{formatDate(step.at)}</time> : '—'}</dd>
                    </div>
                ))}
                {order.trackingNumber && (
                    <>
                        <dt className='text-muted-foreground'>Tracking</dt>
                        <dd>
                            {order.carrier} <span className='font-mono'>{order.trackingNumber}</span>
                        </dd>
                    </>
                )}
            </dl>
        </section>
    );
}
