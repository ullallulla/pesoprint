import { startTransition, StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import type { ClientOnErrorFunction } from 'react-router';
import { HydratedRouter } from 'react-router/dom';

import { isReportable, readSentryConfig } from '~/lib/sentry';

// Sentry is loaded only when the site reports errors, and without holding up the page: errors that happen before it
// has loaded wait for it.
const sentryConfig = readSentryConfig(document);
const sentry = sentryConfig
    ? import('~/lib/sentry.client').then((module) => {
          module.startSentry(sentryConfig);
          return module;
      })
    : null;

const onError: ClientOnErrorFunction = (error, info) => {
    if (sentry && isReportable(error)) void sentry.then(({ reportError }) => reportError(error, info));
};

startTransition(() => {
    hydrateRoot(
        document,
        <StrictMode>
            <HydratedRouter onError={onError} />
        </StrictMode>,
    );
});
