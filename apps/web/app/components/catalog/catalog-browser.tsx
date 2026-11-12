import { CATALOG_SORTS, type CatalogOffer, type CatalogProductList } from '@app/shared';
import { Search, SearchX } from 'lucide-react';
import { Form, Link, useNavigation, useSubmit } from 'react-router';

import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { catalogSearch, OFFER_LABELS, PAGE_SIZE, SORT_LABELS, type CatalogParams } from '~/lib/catalog-params';
import { cn } from '~/lib/utils';

import { Pagination } from './pagination';
import { ProductGrid } from './product-grid';

interface CatalogBrowserProps {
    list: CatalogProductList;
    params: CatalogParams;
    /** The page these filters belong to, e.g. `/models` or `/categories/toys`. */
    basePath: string;
}

/** Search, sort and offer filters with the results and pagination. Works without JavaScript (plain GET form). */
export function CatalogBrowser({ list, params, basePath }: CatalogBrowserProps) {
    const navigation = useNavigation();
    const submit = useSubmit();
    const loading = navigation.state === 'loading' && navigation.location.pathname === basePath;
    const pageCount = Math.max(1, Math.ceil(list.total / PAGE_SIZE));
    // The first option is "no explicit sort": best match while searching, newest otherwise.
    // That way a new search isn't stuck with the previous search's sort.
    const defaultSort = params.q ? 'relevance' : 'newest';
    const sorts = CATALOG_SORTS.filter((sort) => sort !== defaultSort && sort !== 'relevance');

    /** Submits the form without empty fields, so URLs stay short (`?q=clip`, not `?q=clip&sort=`). */
    function submitFilters(form: HTMLFormElement) {
        const search = new URLSearchParams();
        for (const [name, value] of new FormData(form)) {
            if (typeof value === 'string' && value.trim()) search.set(name, value.trim());
        }
        void submit(search, { method: 'get', action: basePath });
    }

    const href = (changes: Partial<CatalogParams>) => `${basePath}${catalogSearch({ ...params, page: 1, ...changes })}`;

    return (
        <div className='flex flex-col gap-6'>
            <search>
                <Form
                    method='get'
                    action={basePath}
                    onSubmit={(event) => {
                        event.preventDefault();
                        submitFilters(event.currentTarget);
                    }}
                    className='flex flex-col gap-3 sm:flex-row sm:items-center'
                >
                    <div className='relative flex-1'>
                        <Search
                            className='pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground'
                            aria-hidden
                        />
                        <Input
                            type='search'
                            name='q'
                            defaultValue={params.q ?? ''}
                            key={params.q ?? ''}
                            placeholder='Search models'
                            aria-label='Search models'
                            className='pl-9'
                        />
                    </div>
                    {params.offer && <input type='hidden' name='offer' value={params.offer} />}
                    <label className='flex items-center gap-2 text-sm text-muted-foreground'>
                        Sort
                        <select
                            name='sort'
                            defaultValue={params.sort ?? ''}
                            key={params.sort ?? ''}
                            onChange={(event) => event.currentTarget.form && submitFilters(event.currentTarget.form)}
                            className='h-9 rounded-md border bg-background px-2 text-sm text-foreground shadow-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
                        >
                            <option value=''>{SORT_LABELS[defaultSort]}</option>
                            {sorts.map((sort) => (
                                <option key={sort} value={sort}>
                                    {SORT_LABELS[sort]}
                                </option>
                            ))}
                        </select>
                    </label>
                    <Button type='submit'>Search</Button>
                </Form>
            </search>

            <div className='flex flex-wrap items-center gap-2'>
                <nav aria-label='Filter by how the model is offered'>
                    <ul className='flex flex-wrap gap-2'>
                        <li>
                            <FilterLink to={href({ offer: undefined })} active={!params.offer}>
                                Everything
                            </FilterLink>
                        </li>
                        {(Object.keys(OFFER_LABELS) as CatalogOffer[]).map((offer) => (
                            <li key={offer}>
                                <FilterLink to={href({ offer })} active={params.offer === offer}>
                                    {OFFER_LABELS[offer]}
                                </FilterLink>
                            </li>
                        ))}
                    </ul>
                </nav>
                <p className='ml-auto text-sm text-muted-foreground' aria-live='polite'>
                    {list.total === 1 ? '1 model' : `${list.total} models`}
                    {params.q && <> for “{params.q}”</>}
                </p>
            </div>

            <div aria-busy={loading} className={cn('transition-opacity', loading && 'opacity-60')}>
                {list.products.length > 0 ? (
                    <ProductGrid products={list.products} />
                ) : (
                    <EmptyResults clearHref={basePath} searching={Boolean(params.q || params.offer)} />
                )}
            </div>

            <Pagination
                page={list.page}
                pageCount={pageCount}
                href={(page) => `${basePath}${catalogSearch({ ...params, page })}`}
            />
        </div>
    );
}

function FilterLink({ to, active, children }: { to: string; active: boolean; children: React.ReactNode }) {
    return (
        <Button asChild size='sm' variant={active ? 'default' : 'outline'} className='rounded-full'>
            <Link to={to} aria-current={active ? 'true' : undefined} preventScrollReset>
                {children}
            </Link>
        </Button>
    );
}

function EmptyResults({ clearHref, searching }: { clearHref: string; searching: boolean }) {
    return (
        <div className='flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-16 text-center'>
            <SearchX className='size-8 text-muted-foreground' aria-hidden />
            <p className='font-medium'>{searching ? 'No models match.' : 'No models here yet.'}</p>
            {searching && (
                <>
                    <p className='text-sm text-muted-foreground'>Try fewer or different words, or clear the filters.</p>
                    <Button asChild variant='outline' size='sm'>
                        <Link to={clearHref}>Clear search and filters</Link>
                    </Button>
                </>
            )}
        </div>
    );
}
