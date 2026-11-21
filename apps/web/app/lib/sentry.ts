import { isRouteErrorResponse } from 'react-router';

/** Where the server puts the browser's Sentry settings: a meta tag in every page. */
export const SENTRY_CONFIG_META = 'sentry-config';

/** The web server's Sentry settings that the browser reports with (all of them public: a DSN can only send). */
export interface BrowserSentryConfig {
    dsn: string;
    environment?: string;
    release?: string;
}

/** The settings from the page's meta tag, or null when the site doesn't report errors. */
export function readSentryConfig(page: Pick<Document, 'querySelector'>): BrowserSentryConfig | null {
    const content = page.querySelector<HTMLMetaElement>(`meta[name="${SENTRY_CONFIG_META}"]`)?.content;
    if (!content) return null;
    try {
        const config = JSON.parse(content) as Partial<BrowserSentryConfig>;
        return typeof config.dsn === 'string' ? (config as BrowserSentryConfig) : null;
    } catch {
        return null;
    }
}

/**
 * Whether an error that reached an error boundary is a bug worth reporting. A thrown response (a 404, a 401, the
 * 503 while the API starts up) is a page working as intended.
 */
export const isReportable = (error: unknown) => !isRouteErrorResponse(error);

/**
 * What the SDK may collect besides the error itself: nothing about the visitor (no IP address, cookies, headers,
 * query strings or variable values). The same settings as the API's.
 */
export const SENTRY_DATA_COLLECTION = {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
    databaseQueryData: false,
    queues: false,
    stackFrameVariables: false,
};
