import { describe, expect, test } from 'vite-plus/test';

import { catalogSearch, parseCatalogParams } from './catalog-params';

const parse = (query: string) => parseCatalogParams(new URLSearchParams(query));

describe('parseCatalogParams', () => {
    test('reads valid values', () => {
        expect(parse('q=%20dragon%20&sort=price-asc&offer=free&page=3')).toEqual({
            q: 'dragon',
            sort: 'price-asc',
            offer: 'free',
            page: 3,
        });
    });

    test('drops invalid values instead of failing the page', () => {
        expect(parse('q=&sort=cheapest&offer=gift&page=-2')).toEqual({ page: 1 });
        expect(parse('page=abc')).toEqual({ page: 1 });
        expect(parse('page=99999')).toEqual({ page: 1 });
    });

    test('caps the search length', () => {
        expect(parse(`q=${'a'.repeat(300)}`).q).toHaveLength(100);
    });
});

describe('catalogSearch', () => {
    test('leaves out defaults', () => {
        expect(catalogSearch({ page: 1 })).toBe('');
        expect(catalogSearch({ q: 'clip', page: 2 })).toBe('?q=clip&page=2');
    });

    test('round-trips through parseCatalogParams', () => {
        const params = { q: 'cable clip', sort: 'title' as const, offer: 'print' as const, page: 4 };
        expect(parse(catalogSearch(params).slice(1))).toEqual(params);
    });
});
