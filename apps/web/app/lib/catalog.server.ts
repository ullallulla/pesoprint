import {
    catalogCategoryTreeSchema,
    catalogHomeSchema,
    catalogProductListSchema,
    catalogProductSchema,
    catalogSitemapSchema,
} from '@app/shared';
import { data } from 'react-router';

import { apiFetch, ApiRequestError } from '~/lib/api.server';
import { PAGE_SIZE, type CatalogParams } from '~/lib/catalog-params';

/** Turns an API 404 into a 404 response for the page, so the error page says "not found" with the right status. */
async function orNotFound<T>(request: Promise<T>): Promise<T> {
    try {
        return await request;
    } catch (error) {
        if (error instanceof ApiRequestError && error.status === 404) {
            throw data(null, { status: 404 });
        }
        throw error;
    }
}

export const getHome = () => apiFetch('/api/catalog/home', catalogHomeSchema);

export const getCategoryTree = async () =>
    (await apiFetch('/api/catalog/categories', catalogCategoryTreeSchema)).categories;

export function listProducts(params: CatalogParams & { category?: string }) {
    const search = new URLSearchParams({ page: String(params.page), pageSize: String(PAGE_SIZE) });
    if (params.category) search.set('category', params.category);
    if (params.q) search.set('q', params.q);
    if (params.sort) search.set('sort', params.sort);
    if (params.offer) search.set('offer', params.offer);
    return orNotFound(apiFetch(`/api/catalog/products?${search}`, catalogProductListSchema));
}

export const getProduct = (slug: string) =>
    orNotFound(apiFetch(`/api/catalog/products/${encodeURIComponent(slug)}`, catalogProductSchema));

export const getSitemap = () => apiFetch('/api/catalog/sitemap', catalogSitemapSchema);
