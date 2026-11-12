import type { CatalogProductCard } from '@app/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, test } from 'vite-plus/test';

import { pageWindow } from './pagination';
import { ProductCard } from './product-card';

const card: CatalogProductCard = {
    slug: 'ft5-table-stand',
    title: 'Yaesu FT5 Table Stand',
    category: { slug: 'ham-radio', name: 'Ham radio' },
    cover: { url: 'https://assets.test/ft5.webp', alt: '3D render of the stand', width: 1200, height: 900 },
    digitalPriceCents: 0,
    printBasePriceCents: 1690,
    publishedAt: '2026-11-10T08:30:00.000Z',
};

const render = (product: CatalogProductCard) =>
    renderToStaticMarkup(
        <MemoryRouter>
            <ProductCard product={product} />
        </MemoryRouter>,
    );

describe('ProductCard', () => {
    test('links the title to the product page and shows the offers', () => {
        const html = render(card);
        expect(html).toContain('href="/models/ft5-table-stand"');
        expect(html).toContain('Yaesu FT5 Table Stand');
        expect(html).toContain('Free download');
        expect(html).toContain('Print from €16.90');
    });

    test('reserves the image space and loads it lazily by default', () => {
        const html = render(card);
        expect(html).toContain('width="1200"');
        expect(html).toContain('height="900"');
        expect(html).toContain('loading="lazy"');
        expect(html).toContain('alt="3D render of the stand"');
    });

    test('shows a placeholder when there is no image', () => {
        expect(render({ ...card, cover: null })).not.toContain('<img');
    });
});

describe('pageWindow', () => {
    test.each([
        [1, 1, [1]],
        [1, 3, [1, 2, 3]],
        [5, 10, [1, 'gap', 4, 5, 6, 'gap', 10]],
        [1, 10, [1, 2, 'gap', 10]],
        [10, 10, [1, 'gap', 9, 10]],
        [3, 10, [1, 2, 3, 4, 'gap', 10]],
    ])('page %i of %i', (page, count, expected) => {
        expect(pageWindow(page, count)).toEqual(expected);
    });
});
