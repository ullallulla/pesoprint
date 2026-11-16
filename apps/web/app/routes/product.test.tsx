import type { CatalogProduct } from '@app/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoutesStub } from 'react-router';
import { expect, test } from 'vite-plus/test';

import ProductPage from './product';

const product: CatalogProduct = {
    id: '0190b6a0-0000-7000-8000-000000000101',
    slug: 'hook',
    title: 'Hook',
    description: '',
    category: null,
    cover: null,
    images: [],
    preview: null,
    files: [{ id: '0190b6a0-0000-7000-8000-000000000201', format: 'stl', filename: 'hook.stl', sizeBytes: 1_798_384 }],
    downloadCount: 1234,
    digitalPriceCents: 0,
    printBasePriceCents: 1290,
    license: 'cc_by_nc',
    size: null,
    printWeightG: null,
    publishedAt: '2026-11-10T08:00:00.000Z',
    updatedAt: '2026-11-10T08:00:00.000Z',
};

function render(model: CatalogProduct, { inCart = false } = {}) {
    // oxlint-disable-next-line typescript/no-explicit-any -- the stub supplies the route's props
    const Stub = createRoutesStub([
        { id: 'page', path: '/models/:slug', Component: ProductPage as any, loader: () => null },
    ]);
    return renderToStaticMarkup(
        <Stub
            initialEntries={['/models/hook']}
            hydrationData={{ loaderData: { page: { product: model, url: 'https://shop.test/models/hook', inCart } } }}
        />,
    );
}

test('a free model has a working download link per file, which crawlers are asked not to follow', () => {
    const html = render(product);

    expect(html).toMatch(
        /<a href="\/models\/hook\/download\/0190b6a0-0000-7000-8000-000000000201" rel="nofollow"[^>]*aria-label="Download hook.stl"/,
    );
    expect(html).toContain('Downloaded 1,234 times.');
    expect(html).not.toContain('Free downloads open soon');
    // Prints still wait for M4.
    expect(html).toContain('Print orders open soon.');
});

test('a paid file has no download link, but can be added to the cart', () => {
    const html = render({ ...product, digitalPriceCents: 450, license: 'standard_digital' });
    expect(html).not.toContain('/download/');
    expect(html).toContain('Model file · €4.50');
    // A plain form post, so it works before the page's JavaScript has loaded.
    expect(html).toMatch(/<form[^>]* action="\/models\/hook" method="post">/);
    expect(html).toMatch(/<button[^>]* type="submit" value="add-to-cart" name="intent">/);
    expect(html).not.toContain('href="/cart"');
});

test('a paid file already in the cart links to the cart instead', () => {
    const html = render({ ...product, digitalPriceCents: 450, license: 'standard_digital' }, { inCart: true });
    expect(html).toContain('In your cart');
    expect(html).toContain('href="/cart"');
    expect(html).not.toContain('value="add-to-cart"');
});
