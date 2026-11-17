import type { OrderList, OrderSummary } from '@app/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoutesStub } from 'react-router';
import { expect, test } from 'vite-plus/test';

import OrdersPage from './orders';

const fileOrder: OrderSummary = {
    id: '0190b6a0-0000-7000-8000-000000000901',
    status: 'paid',
    currency: 'EUR',
    totalCents: 450,
    parcelSize: null,
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
            quantity: 1,
        },
    ],
};

const shippedPrint: OrderSummary = {
    ...fileOrder,
    id: '0190b6a0-0000-7000-8000-000000000902',
    status: 'shipped',
    totalCents: 3070,
    parcelSize: 'M',
    carrier: 'Posti',
    trackingNumber: 'JJFI65432100',
    shippedAt: '2026-11-18T14:00:00.000Z',
    paidAt: '2026-11-17T10:00:00.000Z',
    items: [
        {
            productId: '0190b6a0-0000-7000-8000-000000000102',
            type: 'print',
            title: 'Vase',
            slug: 'vase',
            print: { materialName: 'PLA', colourName: 'Black', colours: [{ name: 'Black', hex: '#1c1c1c' }] },
            quantity: 2,
        },
    ],
};

// Signed out, the page shows Clerk's sign-in button, which needs Clerk's provider: not rendered here.
function render(list: OrderList) {
    // oxlint-disable-next-line typescript/no-explicit-any -- the stub supplies the route's props
    const Stub = createRoutesStub([{ id: 'page', path: '/orders', Component: OrdersPage as any, loader: () => null }]);
    return renderToStaticMarkup(
        <Stub initialEntries={['/orders']} hydrationData={{ loaderData: { page: { list } } }} />,
    );
}

test('says when there are no orders yet', () => {
    const html = render({ orders: [], page: 1, pageSize: 10, total: 0 });
    expect(html).toContain('You haven&#x27;t ordered anything yet.');
    expect(html).toContain('href="/models"');
});

test('a shipped print shows where it has got to and its tracking number', () => {
    const html = render({ orders: [shippedPrint, fileOrder], page: 1, pageSize: 10, total: 2 });

    expect(html).toContain(`href="/orders/${shippedPrint.id}"`);
    expect(html).toMatch(/Order of <time[^>]*>17 Nov 2026/);
    expect(html).toContain('€30.70');
    expect(html).toContain('On its way');
    expect(html).toContain('2 × Vase');
    expect(html).toContain('Print, PLA, Black');
    expect(html).toMatch(/<li aria-current="step"[^>]*>.*?Shipped/);
    expect(html).toContain('JJFI65432100');
    // Only the print order has progress.
    expect(html.match(/Order progress/g)).toHaveLength(1);
});

test('a file order is simply paid, with nothing to track', () => {
    const html = render({ orders: [fileOrder], page: 1, pageSize: 10, total: 1 });
    expect(html).toContain('>Paid<');
    expect(html).toContain('Hook<span class="text-muted-foreground"> · File</span>');
    expect(html).not.toContain('Tracking');
});

test('pages through many orders', () => {
    const html = render({ orders: [fileOrder], page: 2, pageSize: 10, total: 25 });
    expect(html).toContain('href="/orders"');
    expect(html).toContain('href="/orders?page=3"');
});
