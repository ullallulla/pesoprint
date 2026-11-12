import { data, Link } from 'react-router';

import { Breadcrumbs, type Crumb } from '~/components/catalog/breadcrumbs';
import { CatalogBrowser } from '~/components/catalog/catalog-browser';
import { Button } from '~/components/ui/button';
import { catalogSearch, parseCatalogParams } from '~/lib/catalog-params';
import { getCategoryTree, listProducts } from '~/lib/catalog.server';
import { pageMeta } from '~/lib/seo';
import { absoluteUrl } from '~/lib/site.server';

import type { Route } from './+types/category';

export async function loader({ request, params: { slug } }: Route.LoaderArgs) {
    const tree = await getCategoryTree();
    const parent =
        tree.find((c) => c.slug === slug) ?? tree.find((c) => c.children.some((child) => child.slug === slug));
    if (!parent) {
        throw data(null, { status: 404 });
    }
    const isTopLevel = parent.slug === slug;
    const category = isTopLevel ? parent : parent.children.find((child) => child.slug === slug)!;

    const params = parseCatalogParams(new URL(request.url).searchParams);
    const list = await listProducts({ ...params, category: slug });
    // A page past the end (old link, edited URL) is a 404, not an empty listing.
    if (params.page > 1 && list.products.length === 0) {
        throw data(null, { status: 404 });
    }

    return {
        category: { slug: category.slug, name: category.name, description: category.description },
        parent: isTopLevel ? null : { slug: parent.slug, name: parent.name },
        // Top-level categories show their subcategories; subcategories show their siblings.
        subcategories: parent.children.filter((child) => child.productCount > 0),
        parentSlug: parent.slug,
        list,
        params,
        url: absoluteUrl(`/categories/${slug}${catalogSearch({ page: params.page })}`),
        filtered: Boolean(params.q || params.offer || params.sort),
    };
}

export const meta: Route.MetaFunction = ({ loaderData }) =>
    loaderData
        ? pageMeta({
              title: loaderData.category.name,
              description:
                  loaderData.category.description ??
                  `${loaderData.category.name}: 3D models to download or order printed.`,
              url: loaderData.url,
              noindex: loaderData.filtered,
          })
        : [];

export default function Category({ loaderData }: Route.ComponentProps) {
    const { category, parent, subcategories, parentSlug, list, params } = loaderData;
    const crumbs: Crumb[] = [
        { label: 'Home', to: '/' },
        { label: 'Models', to: '/models' },
        ...(parent ? [{ label: parent.name, to: `/categories/${parent.slug}` }] : []),
        { label: category.name },
    ];

    return (
        <main className='mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-4 py-10'>
            <div className='space-y-3'>
                <Breadcrumbs items={crumbs} />
                <h1 className='text-3xl font-bold tracking-tight'>{category.name}</h1>
                {category.description && <p className='max-w-2xl text-muted-foreground'>{category.description}</p>}
            </div>

            {subcategories.length > 0 && (
                <nav aria-label={`Categories in ${parent?.name ?? category.name}`}>
                    <ul className='flex flex-wrap gap-2'>
                        <li>
                            <Button asChild size='sm' variant={category.slug === parentSlug ? 'secondary' : 'ghost'}>
                                <Link to={`/categories/${parentSlug}`}>All {parent?.name ?? category.name}</Link>
                            </Button>
                        </li>
                        {subcategories.map((sub) => (
                            <li key={sub.slug}>
                                <Button asChild size='sm' variant={sub.slug === category.slug ? 'secondary' : 'ghost'}>
                                    <Link
                                        to={`/categories/${sub.slug}`}
                                        aria-current={sub.slug === category.slug ? 'page' : undefined}
                                    >
                                        {sub.name}
                                    </Link>
                                </Button>
                            </li>
                        ))}
                    </ul>
                </nav>
            )}

            <CatalogBrowser list={list} params={params} basePath={`/categories/${category.slug}`} />
        </main>
    );
}
