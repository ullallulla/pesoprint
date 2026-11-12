import {
    adminCategoryListSchema,
    adminProductListSchema,
    PRODUCT_STATUSES,
    productStatusSchema,
    type AdminCategory,
} from '@app/shared';
import { cn } from 'cn';
import { Plus, Search } from 'lucide-react';
import { Form, Link } from 'react-router';

import { FeaturedBadge, StatusBadge } from '~/components/admin/product-status';
import { Pagination } from '~/components/catalog/pagination';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { adminApi } from '~/lib/admin.server';
import { offerLines } from '~/lib/format';

import type { Route } from './+types/products';

export const meta: Route.MetaFunction = () => [
    { title: 'Products – Admin – Pesoprint' },
    { name: 'robots', content: 'noindex' },
];

const PAGE_SIZE = 25;

/** Reads the filters from the URL, ignoring values that aren't valid (a hand-edited URL shouldn't error). */
function parseFilters(url: URL) {
    const status = productStatusSchema.safeParse(url.searchParams.get('status'));
    const page = Number(url.searchParams.get('page'));
    return {
        status: status.success ? status.data : undefined,
        q: url.searchParams.get('q')?.trim().slice(0, 100) || undefined,
        page: Number.isInteger(page) && page > 1 ? page : 1,
    };
}

export async function loader(args: Route.LoaderArgs) {
    const filters = parseFilters(new URL(args.request.url));
    const query = new URLSearchParams({ page: String(filters.page), pageSize: String(PAGE_SIZE) });
    if (filters.status) query.set('status', filters.status);
    if (filters.q) query.set('q', filters.q);

    const [list, { categories }] = await Promise.all([
        adminApi(args, `/api/admin/products?${query}`, adminProductListSchema),
        adminApi(args, '/api/admin/categories', adminCategoryListSchema),
    ]);
    return { list, categories, filters };
}

const STATUS_FILTER_LABELS = { all: 'All', draft: 'Drafts', published: 'Published', archived: 'Archived' };

function categoryLabel(categories: AdminCategory[], id: string | null) {
    const category = categories.find((c) => c.id === id);
    if (!category) return null;
    const parent = categories.find((c) => c.id === category.parentId);
    return parent ? `${parent.name} › ${category.name}` : category.name;
}

const dateFormat = new Intl.DateTimeFormat('en-IE', { dateStyle: 'medium', timeZone: 'UTC' }); // Same on server and browser.

export default function AdminProducts({ loaderData }: Route.ComponentProps) {
    const { list, categories, filters } = loaderData;
    const pageCount = Math.max(1, Math.ceil(list.total / list.pageSize));

    const href = (changes: { status?: string; page?: number }) => {
        const params = new URLSearchParams();
        const status = 'status' in changes ? changes.status : filters.status;
        if (status) params.set('status', status);
        if (filters.q) params.set('q', filters.q);
        if (changes.page && changes.page > 1) params.set('page', String(changes.page));
        const search = params.toString();
        return search ? `/admin/products?${search}` : '/admin/products';
    };

    return (
        <main className='flex flex-col gap-6'>
            <div className='flex flex-wrap items-end justify-between gap-4'>
                <h1 className='text-3xl font-bold tracking-tight'>Products</h1>
                <Button asChild>
                    <Link to='/admin/products/new'>
                        <Plus aria-hidden />
                        New product
                    </Link>
                </Button>
            </div>

            <div className='flex flex-wrap items-center justify-between gap-4'>
                <nav aria-label='Status' className='flex flex-wrap gap-1'>
                    {(['all', ...PRODUCT_STATUSES] as const).map((status) => {
                        const current = (filters.status ?? 'all') === status;
                        return (
                            <Button key={status} asChild size='sm' variant={current ? 'secondary' : 'ghost'}>
                                <Link
                                    to={href({ status: status === 'all' ? undefined : status })}
                                    aria-current={current ? 'page' : undefined}
                                >
                                    {STATUS_FILTER_LABELS[status]}
                                </Link>
                            </Button>
                        );
                    })}
                </nav>
                <search>
                    <Form method='get' className='flex gap-2'>
                        {filters.status && <input type='hidden' name='status' value={filters.status} />}
                        <Input
                            type='search'
                            name='q'
                            defaultValue={filters.q}
                            placeholder='Title or slug'
                            aria-label='Search products'
                            className='w-56'
                        />
                        <Button type='submit' variant='outline' size='icon' aria-label='Search'>
                            <Search aria-hidden />
                        </Button>
                    </Form>
                </search>
            </div>

            {list.products.length === 0 ? (
                <p className='rounded-lg border border-dashed p-8 text-center text-muted-foreground'>
                    {filters.q || filters.status ? 'No products match.' : 'No products yet. Create the first one.'}
                </p>
            ) : (
                <div className='overflow-x-auto rounded-lg border'>
                    <table className='w-full text-sm'>
                        <caption className='sr-only'>
                            Products, most recently updated first. {list.total} in total.
                        </caption>
                        <thead className='border-b bg-muted/50 text-left text-muted-foreground'>
                            <tr>
                                <th scope='col' className='px-4 py-2 font-medium'>
                                    Product
                                </th>
                                <th scope='col' className='px-4 py-2 font-medium'>
                                    Status
                                </th>
                                <th scope='col' className='px-4 py-2 font-medium'>
                                    Category
                                </th>
                                <th scope='col' className='px-4 py-2 font-medium'>
                                    Offers
                                </th>
                                <th scope='col' className='px-4 py-2 font-medium'>
                                    Updated
                                </th>
                            </tr>
                        </thead>
                        <tbody className='divide-y'>
                            {list.products.map((product) => {
                                const offers = offerLines(product);
                                return (
                                    <tr key={product.id} className='hover:bg-muted/30'>
                                        <td className='px-4 py-3'>
                                            <Link
                                                to={`/admin/products/${product.id}`}
                                                className='font-medium hover:underline'
                                            >
                                                {product.title}
                                            </Link>
                                            <p className='font-mono text-xs text-muted-foreground'>{product.slug}</p>
                                        </td>
                                        <td className='px-4 py-3'>
                                            <div className='flex flex-wrap gap-1'>
                                                <StatusBadge status={product.status} />
                                                {product.featuredAt && <FeaturedBadge />}
                                            </div>
                                        </td>
                                        <td
                                            className={cn(
                                                'px-4 py-3',
                                                !product.categoryId && 'text-muted-foreground italic',
                                            )}
                                        >
                                            {categoryLabel(categories, product.categoryId) ?? 'None'}
                                        </td>
                                        <td className='px-4 py-3'>
                                            {offers.length > 0 ? (
                                                offers.map((offer) => <p key={offer.kind}>{offer.label}</p>)
                                            ) : (
                                                <span className='text-muted-foreground italic'>None yet</span>
                                            )}
                                        </td>
                                        <td className='px-4 py-3 whitespace-nowrap text-muted-foreground'>
                                            <time dateTime={product.updatedAt}>
                                                {dateFormat.format(new Date(product.updatedAt))}
                                            </time>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            <Pagination page={list.page} pageCount={pageCount} href={(page) => href({ page })} />
        </main>
    );
}
