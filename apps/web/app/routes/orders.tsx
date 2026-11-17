import type { OrderSummary } from '@app/shared';
import { SignInButton } from '@clerk/react-router';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router';

import { Pagination } from '~/components/catalog/pagination';
import { ColourSwatch } from '~/components/colour-swatch';
import { OrderProgress, Shipment } from '~/components/order-progress';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { formatDate, formatPrice } from '~/lib/format';
import { buyerStatusLabel } from '~/lib/order-status';
import { listOrders } from '~/lib/orders.server';
import { printOptionText } from '~/lib/print-option';

import type { Route } from './+types/orders';

export const meta: Route.MetaFunction = () => [
    { title: 'Your orders – Pesoprint' },
    { name: 'robots', content: 'noindex' },
];

const PAGE_SIZE = 10;

/** `/orders`: the visitor's orders, newest first, and where their parcels are. `list` is `null` when signed out. */
export async function loader(args: Route.LoaderArgs) {
    const page = Number(new URL(args.request.url).searchParams.get('page'));
    return { list: await listOrders(args, Number.isInteger(page) && page > 1 ? page : 1, PAGE_SIZE) };
}

export default function OrdersPage({ loaderData }: Route.ComponentProps) {
    const { list } = loaderData;
    return (
        <main className='mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10'>
            {list === null ? (
                <>
                    <h1 className='text-3xl font-bold tracking-tight'>Sign in to see your orders</h1>
                    <p className='text-muted-foreground'>Follow your prints from the printer to your door.</p>
                    <SignInButton mode='modal'>
                        <Button className='self-start'>Sign in</Button>
                    </SignInButton>
                </>
            ) : (
                <>
                    <div className='flex flex-col gap-2'>
                        <h1 className='text-3xl font-bold tracking-tight'>Your orders</h1>
                        <p className='text-muted-foreground'>
                            Everything you&apos;ve bought, newest first. Prints show where they&apos;ve got to, with the
                            tracking number once they&apos;re on their way.
                        </p>
                    </div>
                    {list.orders.length === 0 ? (
                        <div className='flex flex-col items-start gap-4'>
                            <p className='text-muted-foreground'>You haven&apos;t ordered anything yet.</p>
                            <Button asChild variant='outline'>
                                <Link to='/models'>Browse models</Link>
                            </Button>
                        </div>
                    ) : (
                        <ul className='flex flex-col gap-4'>
                            {list.orders.map((order) => (
                                <OrderCard key={order.id} order={order} />
                            ))}
                        </ul>
                    )}
                    <Pagination
                        page={list.page}
                        pageCount={Math.max(1, Math.ceil(list.total / list.pageSize))}
                        href={(page) => (page > 1 ? `/orders?page=${page}` : '/orders')}
                    />
                </>
            )}
        </main>
    );
}

function OrderCard({ order }: { order: OrderSummary }) {
    const date = order.paidAt ?? order.createdAt;
    const headingId = `order-${order.id}`;

    return (
        <li>
            <article aria-labelledby={headingId} className='flex flex-col gap-4 rounded-lg border p-4'>
                <div className='flex flex-wrap items-start justify-between gap-2'>
                    <div className='flex flex-col gap-0.5'>
                        <h2 id={headingId} className='font-medium'>
                            <Link to={`/orders/${order.id}`} className='flex items-center gap-1 hover:underline'>
                                Order of <time dateTime={date}>{formatDate(date)}</time>
                                <ChevronRight className='size-4' aria-hidden />
                            </Link>
                        </h2>
                        <p className='text-sm text-muted-foreground tabular-nums'>{formatPrice(order.totalCents)}</p>
                    </div>
                    <Badge variant={order.status === 'refunded' ? 'outline' : 'secondary'}>
                        {buyerStatusLabel(order)}
                    </Badge>
                </div>

                <ul className='flex flex-col gap-1 text-sm'>
                    {order.items.map((item, index) => (
                        <li key={index} className='flex items-center gap-1.5'>
                            {item.print && item.print.colours.length > 0 && (
                                <ColourSwatch colours={item.print.colours} className='size-3' />
                            )}
                            <span>
                                {item.quantity > 1 && `${item.quantity} × `}
                                {item.title}
                                <span className='text-muted-foreground'>
                                    {' · '}
                                    {item.print ? `Print, ${printOptionText(item.print)}` : 'File'}
                                </span>
                            </span>
                        </li>
                    ))}
                </ul>

                {order.parcelSize && (
                    <>
                        <OrderProgress status={order.status} />
                        <Shipment
                            carrier={order.carrier}
                            trackingNumber={order.trackingNumber}
                            shippedAt={order.shippedAt}
                            deliveredAt={order.deliveredAt}
                        />
                    </>
                )}
            </article>
        </li>
    );
}
