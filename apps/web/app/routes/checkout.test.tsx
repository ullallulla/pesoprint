import type { CartQuote } from '@app/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoutesStub } from 'react-router';
import { expect, test } from 'vite-plus/test';

import CheckoutPage from './checkout';

const quote: CartQuote = {
    lines: [
        {
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
        },
    ],
    removed: [],
    currency: 'EUR',
    subtotalCents: 450,
    parcelSize: null,
    shippingCents: 0,
    totalCents: 450,
    taxCents: 91,
    vatCountry: 'FI',
    vatRateBp: 2550,
};

test('a signed-in buyer sees what they pay for, with its VAT, and a button that posts to checkout', () => {
    // oxlint-disable-next-line typescript/no-explicit-any -- the stub supplies the route's props
    const Stub = createRoutesStub([
        { id: 'page', path: '/checkout', Component: CheckoutPage as any, loader: () => null },
    ]);
    const html = renderToStaticMarkup(
        <Stub initialEntries={['/checkout']} hydrationData={{ loaderData: { page: { quote, signedIn: true } } }} />,
    );

    expect(html).toContain('Hook');
    expect(html).toContain('Includes VAT 25.5 %');
    expect(html).toContain('€0.91');
    expect(html).toMatch(/<form[^>]* action="\/checkout" method="post">/);
    expect(html).toMatch(/<button[^>]* type="submit"[^>]*>.*Pay €4.50<\/button>/s);
});

test('the buyer has to tick the immediate-delivery box themselves before paying', () => {
    // oxlint-disable-next-line typescript/no-explicit-any -- the stub supplies the route's props
    const Stub = createRoutesStub([
        { id: 'page', path: '/checkout', Component: CheckoutPage as any, loader: () => null },
    ]);
    const html = renderToStaticMarkup(
        <Stub initialEntries={['/checkout']} hydrationData={{ loaderData: { page: { quote, signedIn: true } } }} />,
    );

    const checkbox = html.match(/<input[^>]*name="immediateDeliveryConsent"[^>]*>/)?.[0];
    expect(checkbox).toBeDefined();
    expect(checkbox).toContain('type="checkbox"');
    expect(checkbox).toContain('required');
    expect(checkbox).not.toContain('checked');
    expect(html).toContain('14-day right of withdrawal');
});

test('a cart of prints is paid like files, with its shipping, and asks no immediate-delivery consent', () => {
    const withPrint: CartQuote = {
        ...quote,
        lines: [
            {
                ...quote.lines[0]!,
                productId: '0190b6a0-0000-7000-8000-000000000105',
                type: 'print',
                materialId: '0190b6a0-0000-7000-8000-000000000300',
                colourOptionId: '0190b6a0-0000-7000-8000-000000000301',
                title: 'Vase',
                license: null,
                print: { materialName: 'PLA', colourName: 'Black', colours: [{ name: 'Black', hex: '#1c1c1c' }] },
                unitPriceCents: 1290,
                quantity: 2,
            },
        ],
        subtotalCents: 2580,
        parcelSize: 'S',
        shippingCents: 290,
        totalCents: 2870,
    };
    // oxlint-disable-next-line typescript/no-explicit-any -- the stub supplies the route's props
    const Stub = createRoutesStub([
        { id: 'page', path: '/checkout', Component: CheckoutPage as any, loader: () => null },
    ]);
    const html = renderToStaticMarkup(
        <Stub
            initialEntries={['/checkout']}
            hydrationData={{ loaderData: { page: { quote: withPrint, signedIn: true } } }}
        />,
    );

    expect(html).toContain('2 × Vase');
    expect(html).toContain('print, PLA, Black');
    expect(html).toContain('small parcel');
    expect(html).toContain('€2.90');
    expect(html).toMatch(/<button[^>]* type="submit"[^>]*>.*Pay €28.70<\/button>/s);
    expect(html).toContain('It asks where to send your prints: we ship within Finland for now.');
    // The right of withdrawal stays: nothing to give up for prints.
    expect(html).not.toContain('name="immediateDeliveryConsent"');
});
