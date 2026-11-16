import type { Order } from '@app/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoutesStub } from 'react-router';
import { expect, test } from 'vite-plus/test';

import OrderPage from './order';

const order: Order = {
    id: '0190b6a0-0000-7000-8000-000000000901',
    status: 'paid',
    currency: 'EUR',
    subtotalCents: 450,
    taxCents: 91,
    totalCents: 450,
    vatRateBp: 2550,
    createdAt: '2026-11-16T12:00:00.000Z',
    paidAt: '2026-11-16T12:01:00.000Z',
    items: [
        {
            productId: '0190b6a0-0000-7000-8000-000000000101',
            type: 'digital',
            title: 'Hook',
            slug: 'hook',
            unitPriceCents: 450,
            quantity: 1,
            files: [
                {
                    id: '0190b6a0-0000-7000-8000-000000000201',
                    format: 'stl',
                    filename: 'hook.stl',
                    sizeBytes: 1_798_384,
                },
            ],
        },
    ],
};

function render(model: Order) {
    // oxlint-disable-next-line typescript/no-explicit-any -- the stub supplies the route's props
    const Stub = createRoutesStub([
        { id: 'page', path: '/orders/:id', Component: OrderPage as any, loader: () => null },
    ]);
    return renderToStaticMarkup(
        <Stub initialEntries={[`/orders/${model.id}`]} hydrationData={{ loaderData: { page: { order: model } } }} />,
    );
}

test('a paid order thanks the buyer and has a download link per file', () => {
    const html = render(order);
    expect(html).toContain('Thank you for your order');
    expect(html).toMatch(
        /<a href="\/models\/hook\/download\/0190b6a0-0000-7000-8000-000000000201" rel="nofollow"[^>]*aria-label="Download hook.stl"/,
    );
    expect(html).toContain('Total paid');
    expect(html).toContain('€4.50');
    expect(html).toContain('Includes VAT 25.5 %');
    expect(html).toContain('€0.91');
});

test('a pending order says the payment is being confirmed, with no downloads', () => {
    const html = render({
        ...order,
        status: 'pending',
        paidAt: null,
        items: order.items.map((item) => ({ ...item, files: [] })),
    });
    expect(html).toContain('Confirming your payment');
    expect(html).not.toContain('/download/');
});

test('a cancelled order says nothing was charged and leads back to the cart', () => {
    const html = render({ ...order, status: 'cancelled', paidAt: null });
    expect(html).toContain('The payment didn’t go through');
    expect(html).toContain('Nothing was charged.');
    expect(html).toContain('href="/cart"');
    expect(html).not.toContain('/download/');
});
