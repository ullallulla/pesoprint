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
    shippingCents: 0,
    parcelSize: null,
    totalCents: 450,
    taxCents: 91,
    vatRateBp: 2550,
    shippingAddress: null,
    carrier: null,
    trackingNumber: null,
    shippedAt: null,
    deliveredAt: null,
    createdAt: '2026-11-16T12:00:00.000Z',
    paidAt: '2026-11-16T12:01:00.000Z',
    items: [
        {
            productId: '0190b6a0-0000-7000-8000-000000000101',
            type: 'digital',
            title: 'Hook',
            slug: 'hook',
            print: null,
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
    expect(html).toContain('href="/library"');
});

test('a paid print order shows each print, where it ships, and the shipping', () => {
    const html = render({
        ...order,
        subtotalCents: 2580,
        shippingCents: 490,
        parcelSize: 'M',
        totalCents: 3070,
        shippingAddress: {
            name: 'Maija Meikäläinen',
            phone: '+358401234567',
            line1: 'Esimerkkikatu 1 A 2',
            line2: null,
            postalCode: '00100',
            city: 'Helsinki',
            country: 'FI',
        },
        items: [
            {
                ...order.items[0]!,
                type: 'print',
                title: 'Vase',
                slug: 'vase',
                print: {
                    materialName: 'PLA',
                    colourName: 'Black / Orange',
                    colours: [
                        { name: 'Black', hex: '#1c1c1c' },
                        { name: 'Orange', hex: '#f26b1d' },
                    ],
                },
                unitPriceCents: 1290,
                quantity: 2,
                files: [],
            },
        ],
    });
    expect(html).toContain('We’ll print your order and post it to the address below.');
    expect(html).not.toContain('Your files are ready');
    expect(html).toContain('2 × Vase');
    expect(html).toContain('Print · PLA, Black / Orange');
    expect(html).toContain('Esimerkkikatu 1 A 2');
    expect(html).toContain('00100 Helsinki');
    expect(html).toContain('Shipping (medium parcel)');
    expect(html).toContain('€30.70');
    // Nothing to download, so no library link and no "no files" note.
    expect(html).not.toContain('href="/library"');
    expect(html).not.toContain('no files right now');
});

test('an order being printed or shipped still shows what was bought, with its downloads', () => {
    for (const [status, heading] of [
        ['printing', 'Your order is being printed'],
        ['shipped', 'Your order is on its way'],
        ['delivered', 'Your order was delivered'],
    ] as const) {
        const html = render({ ...order, status });
        expect(html).toContain(heading);
        expect(html).toContain('aria-label="Download hook.stl"');
        expect(html).not.toContain('didn’t go through');
    }
});

test('a shipped print order shows its progress and tracking number', () => {
    const html = render({
        ...order,
        status: 'shipped',
        parcelSize: 'S',
        carrier: 'Posti',
        trackingNumber: 'JJFI65432100',
        shippedAt: '2026-11-18T14:00:00.000Z',
        items: [{ ...order.items[0]!, type: 'print', files: [] }],
    });
    expect(html).toContain('Your order is on its way');
    expect(html).toMatch(/<li aria-current="step"[^>]*>.*?Shipped/);
    expect(html).toContain('Posti <span class="font-mono select-all">JJFI65432100</span>');
    expect(html).toContain('18 Nov 2026');
    expect(html).toContain('href="/orders"');
});

test('a paid file order has no delivery progress', () => {
    expect(render(order)).not.toContain('Order progress');
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
