import type { CartLine, CartQuote } from '@app/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoutesStub } from 'react-router';
import { expect, test } from 'vite-plus/test';

import CartPage from './cart';

const line: CartLine = {
    productId: '0190b6a0-0000-7000-8000-000000000101',
    type: 'digital',
    materialId: null,
    colourOptionId: null,
    slug: 'hook',
    title: 'Hook',
    cover: null,
    license: 'standard_digital',
    print: null,
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
    parcelSize: null,
    shippingCents: 0,
    totalCents: 1740,
    taxCents: 354,
    vatCountry: 'FI',
    vatRateBp: 2550,
};

function render(loaderData: { quote: CartQuote | null; removed: CartQuote['removed']; cartCount?: number }) {
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
    expect(html).toMatch(/<a[^>]* href="\/checkout"[^>]*>Checkout<\/a>/);
});

test('says why items were taken out', () => {
    const html = render({
        quote: { ...quote, lines: [line] },
        removed: [
            {
                productId: '0190b6a0-0000-7000-8000-000000000201',
                type: 'digital',
                materialId: null,
                colourOptionId: null,
                title: 'Old hook',
                option: null,
                reason: 'unavailable',
            },
            {
                productId: '0190b6a0-0000-7000-8000-000000000202',
                type: 'digital',
                materialId: null,
                colourOptionId: null,
                title: null,
                option: null,
                reason: 'unavailable',
            },
            {
                productId: '0190b6a0-0000-7000-8000-000000000203',
                type: 'digital',
                materialId: null,
                colourOptionId: null,
                title: 'Stand',
                option: null,
                reason: 'owned',
            },
            {
                productId: '0190b6a0-0000-7000-8000-000000000204',
                type: 'print',
                materialId: '0190b6a0-0000-7000-8000-000000000300',
                colourOptionId: '0190b6a0-0000-7000-8000-000000000301',
                title: 'Vase',
                option: 'PLA, Ocean blue',
                reason: 'option_unavailable',
            },
        ],
    });
    expect(html).toContain(
        'The print of “Vase” in PLA, Ocean blue is no longer available in that colour or material, so it was taken out of your cart.',
    );
    expect(html).toContain('“Old hook” is no longer for sale, so it was taken out of your cart.');
    expect(html).toContain('A model that&#x27;s no longer for sale was taken out of your cart.');
    expect(html).toContain('You already own “Stand”, so it was taken out of your cart.');
});

test('a cart whose every item was taken out says so, and is empty', () => {
    const html = render({
        quote: { ...quote, lines: [], subtotalCents: 0, totalCents: 0, taxCents: 0 },
        removed: [
            {
                productId: line.productId,
                type: 'digital',
                materialId: null,
                colourOptionId: null,
                title: 'Hook',
                option: null,
                reason: 'unavailable',
            },
        ],
    });
    expect(html).toContain('“Hook” is no longer for sale');
    expect(html).toContain('Your cart is empty.');
});

test('a print shows its material, colour and copies, and the order shows its shipping', () => {
    const print: CartLine = {
        ...line,
        productId: '0190b6a0-0000-7000-8000-000000000105',
        type: 'print',
        materialId: '0190b6a0-0000-7000-8000-000000000300',
        colourOptionId: '0190b6a0-0000-7000-8000-000000000301',
        slug: 'vase',
        title: 'Vase',
        license: null,
        print: {
            materialName: 'PETG',
            colourName: 'Black / Orange',
            colours: [
                { name: 'Black', hex: '#1c1c1c' },
                { name: 'Orange', hex: '#f26b1d' },
            ],
        },
        unitPriceCents: 1590,
        quantity: 2,
    };
    const html = render({
        quote: {
            ...quote,
            lines: [line, print],
            subtotalCents: 3630,
            parcelSize: 'M',
            shippingCents: 490,
            totalCents: 4120,
        },
        removed: [],
    });

    expect(html).toContain('Print · PETG, Black / Orange · €15.90 each');
    expect(html).toContain('€31.80');
    expect(html).toMatch(/<option value="2" selected="">2<\/option>/);
    expect(html).toContain('3 items');
    expect(html).toContain('Shipping (medium parcel)');
    expect(html).toContain('€4.90');
    expect(html).toContain('€41.20');
    // The forms say which line they change: the model, material and colour.
    expect(html).toContain('name="materialId" value="0190b6a0-0000-7000-8000-000000000300"');
    expect(html).toContain('name="colourOptionId" value="0190b6a0-0000-7000-8000-000000000301"');
});

test('a print in the colours shown names only its material', () => {
    const print: CartLine = {
        ...line,
        type: 'print',
        materialId: '0190b6a0-0000-7000-8000-000000000300',
        license: null,
        print: { materialName: 'PLA', colourName: null, colours: [] },
        unitPriceCents: 1290,
    };
    const html = render({
        quote: { ...quote, lines: [print], subtotalCents: 1290, parcelSize: 'S', shippingCents: 290, totalCents: 1580 },
        removed: [],
    });
    expect(html).toContain('Print · PLA</p>');
    expect(html).not.toContain('name="colourOptionId"');
});
