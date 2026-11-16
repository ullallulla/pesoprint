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
            slug: 'hook',
            title: 'Hook',
            cover: null,
            license: 'standard_digital',
            unitPriceCents: 450,
            quantity: 1,
        },
    ],
    removed: [],
    currency: 'EUR',
    subtotalCents: 450,
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
