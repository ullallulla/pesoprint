import { formatVatRate, type Order } from '@app/shared';
import { SignInButton } from '@clerk/react-router';
import { getAuth } from '@clerk/react-router/server';
import { CircleCheck, Library, LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { data, Link, useRevalidator } from 'react-router';
import { z } from 'zod';

import { FileDownloads } from '~/components/file-downloads';
import { Button } from '~/components/ui/button';
import { readCart, saveCart } from '~/lib/cart.server';
import { formatPrice } from '~/lib/format';
import { getOrder } from '~/lib/orders.server';

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
    if (order.status !== 'paid') return { order };

    const cart = await readCart(args.request);
    const kept = cart.filter(
        (item) => !order.items.some((bought) => bought.productId === item.productId && bought.type === item.type),
    );
    if (kept.length === cart.length) return { order };
    // `cartCount` corrects the header, whose loader read the cart before this one emptied it.
    return data({ order, cartCount: kept.length }, { headers: { 'Set-Cookie': await saveCart(args.request, kept) } });
}

export default function OrderPage({ loaderData }: Route.ComponentProps) {
    const { order } = loaderData;
    return (
        <main className='mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10'>
            {!order ? (
                <SignInFirst />
            ) : order.status === 'paid' ? (
                <Paid order={order} />
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

function Paid({ order }: { order: Order }) {
    return (
        <>
            <div className='flex flex-col gap-2'>
                <h1 className='flex items-center gap-3 text-3xl font-bold tracking-tight'>
                    <CircleCheck className='size-8 text-primary' aria-hidden />
                    Thank you for your order
                </h1>
                <p className='text-muted-foreground'>
                    Payment received. Your files are ready to download, here or any time from your library.
                </p>
            </div>

            <ul className='flex flex-col gap-4'>
                {order.items.map((item) => (
                    <li key={`${item.type}:${item.productId}`} className='flex flex-col gap-2 rounded-lg border p-4'>
                        <Link to={`/models/${item.slug}`} className='font-medium hover:underline'>
                            {item.title}
                        </Link>
                        {item.files.length === 0 ? (
                            <p className='text-sm text-muted-foreground'>
                                This model has no files right now. Contact us and we&apos;ll sort it out.
                            </p>
                        ) : (
                            <FileDownloads slug={item.slug} files={item.files} />
                        )}
                    </li>
                ))}
            </ul>

            <Button asChild variant='outline' className='self-start'>
                <Link to='/library'>
                    <Library aria-hidden />
                    Go to your library
                </Link>
            </Button>

            <OrderTotals order={order} />
        </>
    );
}

function OrderTotals({ order }: { order: Order }) {
    return (
        <dl className='grid grid-cols-[1fr_auto] gap-y-1 border-t pt-4 text-sm'>
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
                Some payment methods take longer to confirm. You can leave this page: come back to it later, and your
                files will be here once the payment has gone through.
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
