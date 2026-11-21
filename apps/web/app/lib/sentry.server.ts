import { getClient } from '@sentry/react-router';

import type { BrowserSentryConfig } from './sentry';

/**
 * The browser reports to the same Sentry project as this server, with the same environment and release.
 * server.ts starts Sentry before the app loads, so the settings are read from its client. Null without SENTRY_DSN.
 */
export function browserSentryConfig(): BrowserSentryConfig | null {
    const options = getClient()?.getOptions();
    if (!options?.dsn) return null;
    return { dsn: options.dsn, environment: options.environment, release: options.release };
}
