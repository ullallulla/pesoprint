import { adminOverviewSchema, adminProductListSchema, type ProductStatus } from '@app/shared';
import { Plus } from 'lucide-react';
import { Link } from 'react-router';

import { Button } from '~/components/ui/button';
import { adminApi } from '~/lib/admin.server';

import type { Route } from './+types/overview';

export async function loader(args: Route.LoaderArgs) {
    const countOf = async (status: ProductStatus) =>
        (await adminApi(args, `/api/admin/products?status=${status}&pageSize=1`, adminProductListSchema)).total;

    const [overview, published, drafts, archived] = await Promise.all([
        adminApi(args, '/api/admin/overview', adminOverviewSchema),
        countOf('published'),
        countOf('draft'),
        countOf('archived'),
    ]);
    return { userCount: overview.userCount, products: { published, drafts, archived } };
}

export default function AdminOverview({ loaderData }: Route.ComponentProps) {
    const { userCount, products } = loaderData;
    const stats = [
        { label: 'Published', value: products.published, to: '/admin/products?status=published' },
        { label: 'Drafts', value: products.drafts, to: '/admin/products?status=draft' },
        { label: 'Archived', value: products.archived, to: '/admin/products?status=archived' },
        { label: 'Users', value: userCount, to: null },
    ];

    return (
        <main className='flex flex-col gap-8'>
            <div className='flex flex-wrap items-end justify-between gap-4'>
                <div className='space-y-1'>
                    <h1 className='text-3xl font-bold tracking-tight'>Admin dashboard</h1>
                    <p className='text-muted-foreground'>Orders and settings arrive here in the next milestones.</p>
                </div>
                <Button asChild>
                    <Link to='/admin/products/new'>
                        <Plus aria-hidden />
                        New product
                    </Link>
                </Button>
            </div>

            <section aria-label='Totals' className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
                {stats.map((stat) => (
                    <div key={stat.label} className='relative rounded-lg border p-4'>
                        <p className='text-sm font-medium text-muted-foreground'>
                            {stat.to ? (
                                <Link to={stat.to} className='after:absolute after:inset-0 hover:text-foreground'>
                                    {stat.label}
                                </Link>
                            ) : (
                                stat.label
                            )}
                        </p>
                        <p className='mt-2 text-3xl font-bold'>{stat.value}</p>
                    </div>
                ))}
            </section>
        </main>
    );
}
