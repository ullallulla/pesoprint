import type { CatalogProductCard } from '@app/shared';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router';

import { ProductGrid } from '~/components/catalog/product-grid';
import { Button } from '~/components/ui/button';
import { getCategoryTree, getHome } from '~/lib/catalog.server';
import { pageMeta, SITE_NAME } from '~/lib/seo';
import { absoluteUrl } from '~/lib/site.server';

import type { Route } from './+types/home';

const DESCRIPTION = 'Download free 3D models, buy model files, or order them printed in your colour and material.';

export async function loader() {
    const [home, categories] = await Promise.all([getHome(), getCategoryTree()]);
    return {
        ...home,
        categories: categories.filter((category) => category.productCount > 0),
        url: absoluteUrl('/'),
        image: home.featured[0]?.cover?.url ?? null,
    };
}

export const meta: Route.MetaFunction = ({ loaderData }) =>
    pageMeta({ title: SITE_NAME, description: DESCRIPTION, url: loaderData?.url ?? '/', image: loaderData?.image });

export default function Home({ loaderData }: Route.ComponentProps) {
    const { featured, newest, categories } = loaderData;

    return (
        <main className='mx-auto flex w-full max-w-7xl flex-1 flex-col gap-16 px-4 py-12 md:py-16'>
            <section className='max-w-2xl space-y-6'>
                <h1 className='text-4xl font-bold tracking-tight md:text-5xl'>3D models, ready to print.</h1>
                <p className='text-lg text-muted-foreground'>
                    Download free models, buy files for your own printer, or let us print and ship them in the colour
                    and material you choose.
                </p>
                <Button asChild size='lg'>
                    <Link to='/models'>
                        Browse models <ArrowRight aria-hidden />
                    </Link>
                </Button>
            </section>

            <ProductSection id='featured' title='Featured' products={featured} />
            <ProductSection id='newest' title='New models' products={newest} />

            {categories.length > 0 && (
                <section aria-labelledby='categories-heading' className='space-y-6'>
                    <h2 id='categories-heading' className='text-2xl font-semibold tracking-tight'>
                        Categories
                    </h2>
                    <ul className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
                        {categories.map((category) => (
                            <li key={category.slug}>
                                <Link
                                    to={`/categories/${category.slug}`}
                                    className='flex h-full flex-col gap-1 rounded-lg border p-5 transition-colors hover:bg-muted'
                                >
                                    <span className='font-medium'>{category.name}</span>
                                    {category.description && (
                                        <span className='text-sm text-muted-foreground'>{category.description}</span>
                                    )}
                                    <span className='mt-2 text-sm text-muted-foreground'>
                                        {category.productCount === 1 ? '1 model' : `${category.productCount} models`}
                                    </span>
                                </Link>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
        </main>
    );
}

function ProductSection({ id, title, products }: { id: string; title: string; products: CatalogProductCard[] }) {
    if (products.length === 0) return null;
    return (
        <section aria-labelledby={`${id}-heading`} className='space-y-6'>
            <div className='flex items-end justify-between gap-4'>
                <h2 id={`${id}-heading`} className='text-2xl font-semibold tracking-tight'>
                    {title}
                </h2>
                <Link to='/models' className='text-sm font-medium text-muted-foreground hover:text-foreground'>
                    See all models
                </Link>
            </div>
            <ProductGrid products={products} />
        </section>
    );
}
