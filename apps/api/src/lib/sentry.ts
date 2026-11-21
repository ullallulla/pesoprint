import * as Sentry from '@sentry/node';

import type { Env } from '../env.ts';

/** What the SDK may collect besides the error itself: nothing about the visitor. */
export const SENTRY_DATA_COLLECTION = {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
    databaseQueryData: false,
    queues: false,
    stackFrameVariables: false,
} satisfies Sentry.NodeOptions['dataCollection'];

/**
 * Starts reporting errors to Sentry, if SENTRY_DSN is set. Errors only: no tracing, profiling or logs.
 *
 * Every `console.error` becomes a Sentry event, so the errors the API already logs are reported without
 * calling Sentry at each one: unhandled errors in requests (`app.onError`), and failures in background work
 * such as order emails, refunds and Stripe checkout. Uncaught exceptions and unhandled rejections are
 * reported by the SDK itself.
 *
 * The release comes from SENTRY_RELEASE, which the Docker image sets to the commit it was built from;
 * on hosts that build the image themselves it falls back to their commit variable (e.g. Render's).
 */
export function initSentry(env: Pick<Env, 'NODE_ENV' | 'SENTRY_DSN' | 'SENTRY_ENVIRONMENT'>): boolean {
    if (!env.SENTRY_DSN) return false;
    Sentry.init({
        dsn: env.SENTRY_DSN,
        environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
        // Only the error, its stack trace and the request's method and path. The SDK's defaults would also send
        // the visitor's IP, headers, query strings, request bodies (a Stripe webhook carries the buyer's name and
        // address) and the values of local variables. Sentry's own data scrubbing (a project setting) also
        // removes email addresses, since an error message can contain one.
        dataCollection: SENTRY_DATA_COLLECTION,
        integrations: [Sentry.captureConsoleIntegration({ levels: ['error'] })],
    });
    return true;
}

/** Sends the errors still waiting to go out, before the process exits. */
export const flushSentry = (timeoutMs = 2000) => Sentry.flush(timeoutMs);
