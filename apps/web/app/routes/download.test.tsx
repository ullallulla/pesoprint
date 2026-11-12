import { renderToStaticMarkup } from 'react-dom/server';
import { createRoutesStub, data } from 'react-router';
import { expect, test } from 'vite-plus/test';

import Download, { ErrorBoundary } from './download';

function renderError(status: number, message: string) {
    const Stub = createRoutesStub([
        {
            id: 'download',
            path: '/models/:slug/download/:fileId',
            Component: Download,
            // oxlint-disable-next-line typescript/no-explicit-any -- the stub supplies the route's props
            ErrorBoundary: ErrorBoundary as any,
            loader: () => {
                throw data(message, { status });
            },
        },
    ]);
    return renderToStaticMarkup(
        <Stub
            initialEntries={['/models/hook/download/x']}
            hydrationData={{ errors: { download: { status, statusText: '', internal: false, data: message } } }}
        />,
    );
}

test('over the limit, the page says when to try again and links back to the model', () => {
    const html = renderError(429, "You've reached the limit of 30 downloads an hour. Try again in 12 minutes.");
    expect(html).toContain('Too many downloads');
    expect(html).toContain('Try again in 12 minutes.');
    expect(html).toContain('href="/models/hook"');
});

test("a file that can't be downloaded is simply not available", () => {
    const html = renderError(404, 'File not found.');
    expect(html).toContain('This file isn&#x27;t available');
});
