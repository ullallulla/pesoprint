import {
    formatVatRate,
    isPaidStatus,
    PARCEL_SIZE_NAMES,
    type Order,
    type PaidOrderStatus,
    type ShippingAddress,
} from '@app/shared';
import { SignInButton } from '@clerk/react-router';
import { getAuth } from '@clerk/react-router/server';
import { ArrowLeft, CircleCheck, Library, LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { data, Link, useRevalidator } from 'react-router';
import { z } from 'zod';

import { ColourSwatch } from '~/components/colour-swatch';
import { FileDownloads } from '~/components/file-downloads';
import { OrderProgress, Shipment } from '~/components/order-progress';
import { Button } from '~/components/ui/button';
import { cartCount, readCart, saveCart } from '~/lib/cart.server';
import { formatPrice } from '~/lib/format';
import { getOrder } from '~/lib/orders.server';
import { printOptionText } from '~/lib/print-option';

import type { Route } from './+types/order';

export const meta: Route.MetaFunction = () => [
    { title: 'Your order – Pesoprint' },
    { name: 'robots', content: 'noindex' },
];

/**
 * `/orders/:id`: where Stripe sends the buyer after paying. The API checks a pending order with Stripe
 * before answering, so it's usually paid by the time this page shows. Once paid, what was bought leaves
 * the cart.
 */
export async function loader(args: Route.LoaderArgs) {
    if (!z.uuid().safeParse(args.params.id).success) throw data(null, { status: 404 });
    const { isAuthenticated } = await getAuth(args);
    if (!isAuthenticated) return { order: null };

    const order = await getOrder(args, args.params.id);
    if (!isPaidStatus(order.status)) return { order };

    const cart = await readCart(args.request);
    const kept = cart.filter(
        (item) => !order.items.some((bought) => bought.productId === item.productId && bought.type === item.type),
    );
    if (kept.length === cart.length) return { order };
    // `cartCount` corrects the header, whose loader read the cart before this one emptied it.
    return data(
        { order, cartCount: cartCount(kept) },
        { headers: { 'Set-Cookie': await saveCart(args.request, kept) } },
    );
}

export default function OrderPage({ loaderData }: Route.ComponentProps) {
    const { order } = loaderData;
    return (
        <main className='mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10'>
            {!order ? (
                <SignInFirst />
            ) : isPaidStatus(order.status) ? (
                <Paid order={{ ...order, status: order.status }} />
            ) : order.status === 'pending' ? (
                <Pending />
            ) : (
                <NotPaid order={order} />
            )}
        </main>
    );
}

function SignInFirst() {
    return (
        <>
            <h1 className='text-3xl font-bold tracking-tight'>Sign in to see your order</h1>
            <SignInButton mode='modal'>
                <Button className='self-start'>Sign in</Button>
            </SignInButton>
        </>
    );
}

const HEADINGS: Record<PaidOrderStatus, string> = {
    paid: 'Thank you for your order',
    printing: 'Your order is being printed',
    shipped: 'Your order is on its way',
    delivered: 'Your order was delivered',
};

function Paid({ order }: { order: Order & { status: PaidOrderStatus } }) {
    const hasFiles = order.items.some((item) => item.type === 'digital');
    const hasPrints = order.items.some((item) => item.type === 'print');

    const files = hasFiles ? ' Your files are ready to download, here or any time from your library.' : '';

    return (
        <>
            <div className='flex flex-col gap-2'>
                <Link
                    to='/orders'
                    className='flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground'
                >
                    <ArrowLeft className='size-4' aria-hidden />
                    Your orders
                </Link>
                <h1 className='flex items-center gap-3 text-3xl font-bold tracking-tight'>
                    {order.status === 'paid' && <CircleCheck className='size-8 text-primary' aria-hidden />}
                    {HEADINGS[order.status]}
                </h1>
                <p className='text-muted-foreground'>
                    {order.status === 'paid' && 'Payment received.'}
                    {order.status === 'paid' &&
                        hasPrints &&
                        ' We’ll print your order and post it to the address below.'}
                    {order.status === 'printing' &&
                        'We’ll post it to the address below, and add the tracking number here.'}
                    {order.status === 'shipped' && 'Follow it with the tracking number below.'}
                    {order.status === 'delivered' && 'We hope you enjoy it.'}
                    {files}
                </p>
            </div>

            {order.parcelSize && (
                <section aria-label='Delivery' className='flex flex-col gap-4 rounded-lg border p-4'>
                    <OrderProgress status={order.status} />
                    <Shipment
                        carrier={order.carrier}
                        trackingNumber={order.trackingNumber}
                        shippedAt={order.shippedAt}
                        deliveredAt={order.deliveredAt}
                    />
                </section>
            )}

            <ul className='flex flex-col gap-4'>
                {order.items.map((item, index) => (
                    <li key={index} className='flex flex-col gap-2 rounded-lg border p-4'>
                        <div className='flex items-start justify-between gap-4'>
                            <Link to={`/models/${item.slug}`} className='font-medium hover:underline'>
                                {item.quantity > 1 && `${item.quantity} × `}
                                {item.title}
                            </Link>
                            <span className='tabular-nums'>{formatPrice(item.unitPriceCents * item.quantity)}</span>
                        </div>
                        {item.print ? (
                            <p className='flex items-center gap-1.5 text-sm text-muted-foreground'>
                                {item.print.colours.length > 0 && (
                                    <ColourSwatch colours={item.print.colours} className='size-3' />
                                )}
                                Print · {printOptionText(item.print)}
                            </p>
                        ) : item.files.length === 0 ? (
                            <p className='text-sm text-muted-foreground'>
                                This model has no files right now. Contact us and we&apos;ll sort it out.
                            </p>
                        ) : (
                            <FileDownloads slug={item.slug} files={item.files} />
                        )}
                    </li>
                ))}
            </ul>

            {hasFiles && (
                <Button asChild variant='outline' className='self-start'>
                    <Link to='/library'>
                        <Library aria-hidden />
                        Go to your library
                    </Link>
                </Button>
            )}

            {order.shippingAddress && <ShipsTo address={order.shippingAddress} />}

            <OrderTotals order={order} />
        </>
    );
}

function ShipsTo({ address }: { address: ShippingAddress }) {
    return (
        <section aria-labelledby='ships-to-heading' className='flex flex-col gap-1 rounded-lg border p-4 text-sm'>
            <h2 id='ships-to-heading' className='font-medium'>
                Ships to
            </h2>
            <address className='text-muted-foreground not-italic'>
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
                {address.country !== 'FI' && (
                    <>
                        <br />
                        {address.country}
                    </>
                )}
            </address>
        </section>
    );
}

function OrderTotals({ order }: { order: Order }) {
    return (
        <dl className='grid grid-cols-[1fr_auto] gap-y-1 border-t pt-4 text-sm'>
            {order.parcelSize && (
                <>
                    <dt className='text-muted-foreground'>Shipping ({PARCEL_SIZE_NAMES[order.parcelSize]} parcel)</dt>
                    <dd className='text-right text-muted-foreground tabular-nums'>
                        {formatPrice(order.shippingCents)}
                    </dd>
                </>
            )}
            <dt className='font-semibold'>Total paid</dt>
            <dd className='text-right font-semibold tabular-nums'>{formatPrice(order.totalCents)}</dd>
            <dt className='text-muted-foreground'>Includes VAT {formatVatRate(order.vatRateBp)}</dt>
            <dd className='text-right text-muted-foreground tabular-nums'>{formatPrice(order.taxCents)}</dd>
            <dt className='text-muted-foreground'>Order</dt>
            <dd className='text-right font-mono text-xs text-muted-foreground'>{order.id}</dd>
        </dl>
    );
}

/** Seconds between checks, and how many before saying it's taking a while (about a minute). */
const POLL_SECONDS = 2;
const MAX_POLLS = 30;

/** Usually only for a moment: the API asks Stripe on every check, and the webhook arrives too. */
function Pending() {
    const { revalidate, state } = useRevalidator();
    const [polls, setPolls] = useState(0);
    const slow = polls >= MAX_POLLS;

    useEffect(() => {
        if (slow || state !== 'idle') return;
        const timer = setTimeout(() => {
            setPolls((count) => count + 1);
            void revalidate();
        }, POLL_SECONDS * 1000);
        return () => clearTimeout(timer);
    }, [polls, revalidate, slow, state]);

    return slow ? (
        <>
            <h1 className='text-3xl font-bold tracking-tight'>Your payment is still being processed</h1>
            <p className='text-muted-foreground'>
                Some payment methods take longer to confirm. You can leave this page: come back to it later, and it will
                show your order once the payment has gone through.
            </p>
            <Button
                variant='outline'
                className='self-start'
                onClick={() => {
                    setPolls(0);
                    void revalidate();
                }}
            >
                Check again
            </Button>
        </>
    ) : (
        <>
            <h1 className='flex items-center gap-3 text-3xl font-bold tracking-tight'>
                <LoaderCircle className='size-7 animate-spin text-muted-foreground' aria-hidden />
                Confirming your payment
            </h1>
            <p className='text-muted-foreground'>This usually takes a few seconds. The page updates by itself.</p>
        </>
    );
}

function NotPaid({ order }: { order: Order }) {
    const refunded = order.status === 'refunded';
    return (
        <>
            <h1 className='text-3xl font-bold tracking-tight'>
                {refunded ? 'This order was refunded' : 'The payment didn’t go through'}
            </h1>
            <p className='text-muted-foreground'>
                {refunded
                    ? 'The money was returned to you.'
                    : 'Nothing was charged. The payment was cancelled, failed, or the time to pay ran out. Your cart still has everything in it.'}
            </p>
            {!refunded && (
                <Button asChild className='self-start'>
                    <Link to='/cart'>Back to cart</Link>
                </Button>
            )}
        </>
    );
}
