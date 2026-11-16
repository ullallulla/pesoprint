import type { LibraryItem } from '@app/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoutesStub } from 'react-router';
import { expect, test } from 'vite-plus/test';

import LibraryPage from './library';

const hook: LibraryItem = {
    productId: '0190b6a0-0000-7000-8000-000000000101',
    slug: 'hook',
    title: 'Hook',
    cover: { url: 'https://assets.test/hook.webp', alt: 'A hook', width: 800, height: 600 },
    listed: true,
    orderId: '0190b6a0-0000-7000-8000-000000000901',
    acquiredAt: '2026-11-16T12:00:00.000Z',
    files: [{ id: '0190b6a0-0000-7000-8000-000000000201', format: 'stl', filename: 'hook.stl', sizeBytes: 1_798_384 }],
};

function render(items: LibraryItem[] | null) {
    // oxlint-disable-next-line typescript/no-explicit-any -- the stub supplies the route's props
    const Stub = createRoutesStub([
        { id: 'page', path: '/library', Component: LibraryPage as any, loader: () => null },
    ]);
    return renderToStaticMarkup(
        <Stub initialEntries={['/library']} hydrationData={{ loaderData: { page: { items } } }} />,
    );
}

test('lists bought models with a download link per file and a link to the order', () => {
    const html = render([hook]);
    expect(html).toContain('Your library');
    expect(html).toContain('href="/models/hook"');
    expect(html).toContain('Bought 16 Nov 2026');
    expect(html).toContain(`href="/orders/${hook.orderId}"`);
    expect(html).toMatch(
        /<a href="\/models\/hook\/download\/0190b6a0-0000-7000-8000-000000000201" rel="nofollow"[^>]*aria-label="Download hook.stl"/,
    );
});

test('an archived model keeps its downloads, without a link to its page', () => {
    const html = render([{ ...hook, listed: false, orderId: null }]);
    expect(html).toContain('No longer sold');
    expect(html).not.toContain('href="/models/hook"');
    expect(html).toContain('/models/hook/download/0190b6a0-0000-7000-8000-000000000201');
    expect(html).toContain('Added 16 Nov 2026');
    expect(html).not.toContain('/orders/');
});

test('an empty library leads to the catalogue', () => {
    const html = render([]);
    expect(html).toContain('You haven&#x27;t bought any models yet.');
    expect(html).toContain('href="/models"');
});
