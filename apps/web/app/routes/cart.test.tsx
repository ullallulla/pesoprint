import type { CartLine, CartQuote } from '@app/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoutesStub } from 'react-router';
import { expect, test } from 'vite-plus/test';

import CartPage from './cart';

const line: CartLine = {
    productId: '0190b6a0-0000-7000-8000-000000000101',
    type: 'digital',
    slug: 'hook',
    title: 'Hook',
    cover: null,
    license: 'standard_digital',
    unitPriceCents: 450,
    quantity: 1,
};

const quote: CartQuote = {
    lines: [
        line,
        {
            ...line,
            productId: '0190b6a0-0000-7000-8000-000000000102',
            slug: 'stand',
            title: 'Stand',
            unitPriceCents: 1290,
            license: 'commercial',
        },
    ],
    removed: [],
    currency: 'EUR',
    subtotalCents: 1740,
    totalCents: 1740,
    taxCents: 354,
    vatCountry: 'FI',
    vatRateBp: 2550,
};

function render(loaderData: { quote: CartQuote | null; removed: CartQuote['removed'] }) {
    // oxlint-disable-next-line typescript/no-explicit-any -- the stub supplies the route's props
    const Stub = createRoutesStub([{ id: 'page', path: '/cart', Component: CartPage as any, loader: () => null }]);
    return renderToStaticMarkup(
        <Stub initialEntries={['/cart']} hydrationData={{ loaderData: { page: loaderData } }} />,
    );
}

test('an empty cart points to the models', () => {
    const html = render({ quote: null, removed: [] });
    expect(html).toContain('Your cart is empty.');
    expect(html).toContain('href="/models"');
    expect(html).not.toContain('Checkout');
});

test('lists each file with its licence, price and a remove button, and the total with its VAT', () => {
    const html = render({ quote, removed: [] });

    expect(html).toContain('href="/models/hook"');
    expect(html).toContain('Model file · Standard Digital File License');
    expect(html).toContain('Model file · Commercial Use License');
    expect(html).toContain('€4.50');
    expect(html).toContain('€12.90');
    expect(html).toMatch(/aria-label="Remove Hook"/);
    expect(html).toContain('2 items');
    expect(html).toContain('€17.40');
    expect(html).toContain('Includes VAT 25.5 %');
    expect(html).toContain('€3.54');
});

test('says why items were taken out', () => {
    const html = render({
        quote: { ...quote, lines: [line] },
        removed: [
            {
                productId: '0190b6a0-0000-7000-8000-000000000201',
                type: 'digital',
                title: 'Old hook',
                reason: 'unavailable',
            },
            { productId: '0190b6a0-0000-7000-8000-000000000202', type: 'digital', title: null, reason: 'unavailable' },
            { productId: '0190b6a0-0000-7000-8000-000000000203', type: 'digital', title: 'Stand', reason: 'owned' },
        ],
    });
    expect(html).toContain('“Old hook” is no longer for sale, so it was taken out of your cart.');
    expect(html).toContain('A model that&#x27;s no longer for sale was taken out of your cart.');
    expect(html).toContain('You already own “Stand”, so it was taken out of your cart.');
});

test('a cart whose every item was taken out says so, and is empty', () => {
    const html = render({
        quote: { ...quote, lines: [], subtotalCents: 0, totalCents: 0, taxCents: 0 },
        removed: [{ productId: line.productId, type: 'digital', title: 'Hook', reason: 'unavailable' }],
    });
    expect(html).toContain('“Hook” is no longer for sale');
    expect(html).toContain('Your cart is empty.');
});
