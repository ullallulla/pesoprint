import * as Sentry from '@sentry/react-router';

import { SENTRY_DATA_COLLECTION, type BrowserSentryConfig } from './sentry';

/** Errors only: no tracing, session replay or user feedback widget. */
export function startSentry(config: BrowserSentryConfig) {
    Sentry.init({ ...config, dataCollection: SENTRY_DATA_COLLECTION });
}

/** Reports an error from React Router's `onError` (loaders, actions and rendering in the browser). */
export const reportError = Sentry.sentryOnError;
