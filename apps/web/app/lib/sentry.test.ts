import { UNSAFE_ErrorResponseImpl as ErrorResponseImpl } from 'react-router';
import { expect, test } from 'vite-plus/test';

import { isReportable, readSentryConfig, SENTRY_CONFIG_META } from './sentry';

/** A page whose head has the given meta tags (name → content). */
function page(metas: Record<string, string>) {
    const querySelector = (selector: string) => {
        const name = /name="([^"]+)"/.exec(selector)?.[1];
        return name !== undefined && name in metas ? { content: metas[name] } : null;
    };
    return { querySelector } as unknown as Pick<Document, 'querySelector'>;
}

test('the browser reports with the settings the server put in the page', () => {
    const config = { dsn: 'https://key@o1.ingest.de.sentry.io/2', environment: 'staging', release: 'abc123' };
    expect(readSentryConfig(page({ [SENTRY_CONFIG_META]: JSON.stringify(config) }))).toEqual(config);
});

test("without the settings, or with broken ones, the browser doesn't report", () => {
    expect(readSentryConfig(page({}))).toBeNull();
    expect(readSentryConfig(page({ [SENTRY_CONFIG_META]: 'not json' }))).toBeNull();
    expect(readSentryConfig(page({ [SENTRY_CONFIG_META]: '{"environment":"staging"}' }))).toBeNull();
});

test('thrown responses (a 404, the 503 while the API starts) are not reported, but bugs are', () => {
    expect(isReportable(new ErrorResponseImpl(404, 'Not Found', null))).toBe(false);
    expect(isReportable(new ErrorResponseImpl(503, '', { reason: 'api_unavailable' }))).toBe(false);
    expect(isReportable(new TypeError("Cannot read properties of undefined (reading 'title')"))).toBe(true);
});
