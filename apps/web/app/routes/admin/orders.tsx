import { adminOrderListSchema, PARCEL_SIZE_NAMES, type AdminOrder, type AdminOrderFilter } from '@app/shared';
import { Search } from 'lucide-react';
import { Form, Link } from 'react-router';

import { orderReference, OrderStatusBadge } from '~/components/admin/order-status';
import { Pagination } from '~/components/catalog/pagination';
import { ColourSwatch } from '~/components/colour-swatch';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { adminApi } from '~/lib/admin.server';
import { formatDate } from '~/lib/format';
import { printOptionText } from '~/lib/print-option';

import type { Route } from './+types/orders';

export const meta: Route.MetaFunction = () => [
    { title: 'Orders – Admin – Pesoprint' },
    { name: 'robots', content: 'noindex' },
];

const PAGE_SIZE = 25;

/** The tabs, in the order work moves. `open` (the default) is what still needs doing; `all` sends no status. */
const TABS = [
    { value: 'open', label: 'To do' },
    { value: 'paid', label: 'Paid' },
    { value: 'printing', label: 'Printing' },
    { value: 'shipped', label: 'Shipped' },
    { value: 'delivered', label: 'Delivered' },
    { value: 'refunded', label: 'Refunded' },
    { value: 'all', label: 'All' },
] as const satisfies readonly { value: AdminOrderFilter | 'all'; label: string }[];
type Tab = (typeof TABS)[number]['value'];

const EMPTY_MESSAGES: Record<Tab, string> = {
    open: 'Nothing to print or ship. New paid orders show up here.',
    paid: 'No paid orders waiting to be printed.',
    printing: 'Nothing is printing.',
    shipped: 'No parcels on their way.',
    delivered: 'No delivered orders yet.',
    refunded: 'No refunded orders.',
    all: 'No print orders yet.',
};

/** Reads the filters from the URL, ignoring values that aren't valid (a hand-edited URL shouldn't error). */
function parseFilters(url: URL) {
    const status = TABS.find((tab) => tab.value === url.searchParams.get('status'))?.value ?? 'open';
    const page = Number(url.searchParams.get('page'));
    return {
        status,
        q: url.searchParams.get('q')?.trim().slice(0, 100) || undefined,
        page: Number.isInteger(page) && page > 1 ? page : 1,
    };
}

export async function loader(args: Route.LoaderArgs) {
    const filters = parseFilters(new URL(args.request.url));
    const query = new URLSearchParams({ page: String(filters.page), pageSize: String(PAGE_SIZE) });
    if (filters.status !== 'all') query.set('status', filters.status);
    if (filters.q) query.set('q', filters.q);

    const list = await adminApi(args, `/api/admin/orders?${query}`, adminOrderListSchema);
    return { list, filters };
}

export default function AdminOrders({ loaderData }: Route.ComponentProps) {
    const { list, filters } = loaderData;
    const pageCount = Math.max(1, Math.ceil(list.total / list.pageSize));

    const href = (changes: { status?: Tab; page?: number }) => {
        const params = new URLSearchParams();
        const status = changes.status ?? filters.status;
        if (status !== 'open') params.set('status', status);
        if (filters.q) params.set('q', filters.q);
        if (changes.page && changes.page > 1) params.set('page', String(changes.page));
        const search = params.toString();
        return search ? `/admin/orders?${search}` : '/admin/orders';
    };

    const oldestFirst = filters.status === 'open' || filters.status === 'paid' || filters.status === 'printing';

    return (
        <main className='flex flex-col gap-6'>
            <div className='space-y-1'>
                <h1 className='text-3xl font-bold tracking-tight'>Orders</h1>
                <p className='text-muted-foreground'>
                    Orders with prints, from payment to the buyer&apos;s door. Orders with only files need nothing done
                    and aren&apos;t listed.
                </p>
            </div>

            <div className='flex flex-wrap items-center justify-between gap-4'>
                <nav aria-label='Status' className='flex flex-wrap gap-1'>
                    {TABS.map((tab) => {
                        const current = filters.status === tab.value;
                        return (
                            <Button key={tab.value} asChild size='sm' variant={current ? 'secondary' : 'ghost'}>
                                <Link to={href({ status: tab.value })} aria-current={current ? 'page' : undefined}>
                                    {tab.label}
                                </Link>
                            </Button>
                        );
                    })}
                </nav>
                <search>
                    <Form method='get' className='flex gap-2'>
                        {filters.status !== 'open' && <input type='hidden' name='status' value={filters.status} />}
                        <Input
                            type='search'
                            name='q'
                            defaultValue={filters.q}
                            placeholder='Name, email, tracking or order'
                            aria-label='Search orders'
                            className='w-64'
                        />
                        <Button type='submit' variant='outline' size='icon' aria-label='Search'>
                            <Search aria-hidden />
                        </Button>
                    </Form>
                </search>
            </div>

            {list.orders.length === 0 ? (
                <p className='rounded-lg border border-dashed p-8 text-center text-muted-foreground'>
                    {filters.q ? 'No orders match.' : EMPTY_MESSAGES[filters.status]}
                </p>
            ) : (
                <div className='overflow-x-auto rounded-lg border'>
                    <table className='w-full text-sm'>
                        <caption className='sr-only'>
                            Orders, {oldestFirst ? 'oldest paid first' : 'newest first'}. {list.total} in total.
                        </caption>
                        <thead className='border-b bg-muted/50 text-left text-muted-foreground'>
                            <tr>
                                <th scope='col' className='px-4 py-2 font-medium'>
                                    Order
                                </th>
                                <th scope='col' className='px-4 py-2 font-medium'>
                                    Buyer
                                </th>
                                <th scope='col' className='px-4 py-2 font-medium'>
                                    Prints
                                </th>
                                <th scope='col' className='px-4 py-2 font-medium'>
                                    Status
                                </th>
                                <th scope='col' className='px-4 py-2 font-medium'>
                                    Shipment
                                </th>
                            </tr>
                        </thead>
                        <tbody className='divide-y'>
                            {list.orders.map((order) => (
                                <OrderRow key={order.id} order={order} />
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <Pagination page={list.page} pageCount={pageCount} href={(page) => href({ page })} />
        </main>
    );
}

function OrderRow({ order }: { order: AdminOrder }) {
    const prints = order.items.filter((item) => item.type === 'print');
    const files = order.items.length - prints.length;
    const date = order.paidAt ?? order.createdAt;

    return (
        <tr className='align-top hover:bg-muted/30'>
            <td className='px-4 py-3 whitespace-nowrap'>
                <Link to={`/admin/orders/${order.id}`} className='font-mono font-medium hover:underline'>
                    {orderReference(order.id)}
                </Link>
                <p className='text-xs text-muted-foreground'>
                    {order.paidAt ? 'Paid ' : 'Placed '}
                    <time dateTime={date}>{formatDate(date)}</time>
                </p>
            </td>
            <td className='px-4 py-3'>
                <p>{order.shippingAddress?.name ?? <span className='text-muted-foreground italic'>No address</span>}</p>
                <p className='text-xs text-muted-foreground'>{order.email}</p>
            </td>
            <td className='px-4 py-3'>
                <ul className='flex flex-col gap-1'>
                    {prints.map((item, index) => (
                        <li key={index} className='flex items-center gap-1.5'>
                            {item.print && item.print.colours.length > 0 && (
                                <ColourSwatch colours={item.print.colours} className='size-3' />
                            )}
                            <span>
                                {item.quantity} × {item.title}
                                {item.print && (
                                    <span className='text-muted-foreground'> · {printOptionText(item.print)}</span>
                                )}
                            </span>
                        </li>
                    ))}
                </ul>
                <p className='mt-1 text-xs text-muted-foreground'>
                    {PARCEL_SIZE_NAMES[order.parcelSize]} parcel
                    {files > 0 && ` · and ${files === 1 ? 'a file' : `${files} files`}`}
                </p>
            </td>
            <td className='px-4 py-3'>
                <OrderStatusBadge status={order.status} />
            </td>
            <td className='px-4 py-3'>
                {order.trackingNumber ? (
                    <>
                        <p>{order.carrier}</p>
                        <p className='font-mono text-xs text-muted-foreground'>{order.trackingNumber}</p>
                    </>
                ) : (
                    <span className='text-muted-foreground'>—</span>
                )}
            </td>
        </tr>
    );
}
