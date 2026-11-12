import { data } from 'react-router';

import { CatalogBrowser } from '~/components/catalog/catalog-browser';
import { Breadcrumbs } from '~/components/catalog/breadcrumbs';
import { catalogSearch, parseCatalogParams } from '~/lib/catalog-params';
import { listProducts } from '~/lib/catalog.server';
import { pageMeta } from '~/lib/seo';
import { absoluteUrl } from '~/lib/site.server';

import type { Route } from './+types/models';

export async function loader({ request }: Route.LoaderArgs) {
    const params = parseCatalogParams(new URL(request.url).searchParams);
    const list = await listProducts(params);
    // A page past the end (old link, edited URL) is a 404, not an empty listing.
    if (params.page > 1 && list.products.length === 0) {
        throw data(null, { status: 404 });
    }
    return {
        list,
        params,
        // Search and filter results stay out of search engines; the canonical URL is the plain listing (or its page).
        url: absoluteUrl(`/models${catalogSearch({ page: params.page })}`),
        filtered: Boolean(params.q || params.offer || params.sort),
    };
}

export const meta: Route.MetaFunction = ({ loaderData }) =>
    pageMeta({
        title: loaderData?.params.q ? `Search: ${loaderData.params.q}` : 'All models',
        description: 'Browse every model: free downloads, files to buy and models we print and ship.',
        url: loaderData?.url ?? '/models',
        noindex: loaderData?.filtered,
    });

export default function Models({ loaderData }: Route.ComponentProps) {
    const { list, params } = loaderData;
    return (
        <main className='mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-4 py-10'>
            <div className='space-y-3'>
                <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Models' }]} />
                <h1 className='text-3xl font-bold tracking-tight'>
                    {params.q ? `Results for “${params.q}”` : 'All models'}
                </h1>
            </div>
            <CatalogBrowser list={list} params={params} basePath='/models' />
        </main>
    );
}
