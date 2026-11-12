import { catalogOfferSchema, catalogSortSchema, type CatalogOffer, type CatalogSort } from '@app/shared';

/** The browse/search state that lives in the URL (`/models?q=…&sort=…&offer=…&page=…`). */
export interface CatalogParams {
    q?: string;
    sort?: CatalogSort;
    offer?: CatalogOffer;
    page: number;
}

export const PAGE_SIZE = 24;

/**
 * Reads the browse state from a URL. Invalid values are dropped rather than failing the page,
 * so a mistyped or old link still shows something sensible.
 */
export function parseCatalogParams(searchParams: URLSearchParams): CatalogParams {
    const q = searchParams.get('q')?.trim().slice(0, 100) || undefined;
    const sort = catalogSortSchema.safeParse(searchParams.get('sort'));
    const offer = catalogOfferSchema.safeParse(searchParams.get('offer'));
    const page = Number.parseInt(searchParams.get('page') ?? '', 10);
    return {
        q,
        sort: sort.success ? sort.data : undefined,
        offer: offer.success ? offer.data : undefined,
        page: Number.isInteger(page) && page >= 1 && page <= 1000 ? page : 1,
    };
}

/** The query string for a browse state, leaving out defaults so URLs stay short. */
export function catalogSearch(params: Partial<CatalogParams>): string {
    const search = new URLSearchParams();
    if (params.q) search.set('q', params.q);
    if (params.sort) search.set('sort', params.sort);
    if (params.offer) search.set('offer', params.offer);
    if (params.page && params.page > 1) search.set('page', String(params.page));
    const query = search.toString();
    return query ? `?${query}` : '';
}

export const SORT_LABELS: Record<CatalogSort, string> = {
    relevance: 'Best match',
    newest: 'Newest',
    downloads: 'Most downloaded',
    'price-asc': 'Price: low to high',
    'price-desc': 'Price: high to low',
    title: 'Name',
};

export const OFFER_LABELS: Record<CatalogOffer, string> = {
    free: 'Free downloads',
    paid: 'Paid files',
    print: 'Prints',
};
