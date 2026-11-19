import type { Favourite } from '@app/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoutesStub } from 'react-router';
import { expect, test, vi } from 'vite-plus/test';

import FavouritesPage from './favourites';

// Clerk's sign-in button needs its provider; here it only has to show what it wraps.
vi.mock('@clerk/react-router', () => ({ SignInButton: ({ children }: { children: React.ReactNode }) => children }));

const hook: Favourite = {
    productId: '0190b6a0-0000-7000-8000-000000000101',
    savedAt: '2026-11-16T12:00:00.000Z',
    product: {
        slug: 'hook',
        title: 'Hook',
        category: null,
        cover: null,
        digitalPriceCents: 0,
        printBasePriceCents: null,
        downloadCount: 0,
        rating: { average: 4.5, count: 2 },
        publishedAt: '2026-11-10T08:00:00.000Z',
    },
};

function render(items: Favourite[] | null) {
    // oxlint-disable-next-line typescript/no-explicit-any -- the stub supplies the route's props
    const Stub = createRoutesStub([
        { id: 'page', path: '/favourites', Component: FavouritesPage as any, loader: () => null },
    ]);
    return renderToStaticMarkup(
        <Stub initialEntries={['/favourites']} hydrationData={{ loaderData: { page: { items } } }} />,
    );
}

test('lists saved models as cards, each with a pressed heart that removes it', () => {
    const html = render([hook]);
    expect(html).toContain('Your favourites');
    expect(html).toContain('href="/models/hook"');
    expect(html).toContain(`name="productId" value="${hook.productId}"`);
    expect(html).toMatch(/<input type="hidden" name="save" value="false"\/>/);
    expect(html).toMatch(/aria-pressed="true" aria-label="Save Hook to favourites"/);
    // The card shows the model's rating.
    expect(html).toContain('4.5');
});

test('an empty list leads to the catalogue', () => {
    const html = render([]);
    expect(html).toContain('Nothing saved yet.');
    expect(html).toContain('href="/models"');
});

test('a visitor who is not signed in is asked to sign in', () => {
    expect(render(null)).toContain('Sign in to see your favourites');
});
