import { renderToStaticMarkup } from 'react-dom/server';
import { createRoutesStub } from 'react-router';
import { expect, test } from 'vite-plus/test';

import { API_UNAVAILABLE } from '~/lib/api-unavailable';
import { ErrorBoundary } from '~/root';

function renderRootError(status: number, data: unknown) {
    const Stub = createRoutesStub([
        {
            id: 'root',
            path: '/',
            Component: () => null,
            // oxlint-disable-next-line typescript/no-explicit-any -- the stub supplies the route's props
            ErrorBoundary: ErrorBoundary as any,
        },
    ]);
    return renderToStaticMarkup(
        <Stub
            initialEntries={['/']}
            hydrationData={{ errors: { root: { status, statusText: '', internal: false, data } } }}
        />,
    );
}

test('a page whose API is still starting up says so, and loads by itself', () => {
    const html = renderRootError(503, API_UNAVAILABLE);
    expect(html).toContain('The site is starting up');
    expect(html).toContain('The page will load by itself');
    expect(html).not.toContain('Something went wrong');
});

test('any other 503 is still an error', () => {
    const html = renderRootError(503, 'Maintenance');
    expect(html).not.toContain('The site is starting up');
    expect(html).toContain('Error 503');
});
