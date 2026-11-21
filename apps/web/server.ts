/**
 * Production server for the web app: `node server.ts` (Node runs TypeScript directly), from apps/web after
 * `vp run build`. It does what `react-router-serve` does, plus one setting that tool doesn't offer:
 * trusting the hosting proxy.
 *
 * Hosts like Render end HTTPS at their proxy and forward plain HTTP to the container. Without
 * `trust proxy`, every request looks like `http://…` to React Router, while the browser's `Origin`
 * header says `https://…`, so React Router refuses every form submission as cross-site (400).
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createRequestHandler } from '@react-router/express';
import * as Sentry from '@sentry/react-router';
import compression from 'compression';
import express from 'express';
import morgan from 'morgan';
import type { ServerBuild } from 'react-router';

// Report errors to Sentry, before the app loads. Errors only. Every console.error becomes an event: that includes
// React Router's own log of each error in a loader, an action or rendering. The release comes from SENTRY_RELEASE,
// set in the Docker image (or the host's commit variable, e.g. Render's). The browser gets these settings from the
// root loader. Collects nothing about the visitor: the same settings as SENTRY_DATA_COLLECTION in app/lib/sentry.ts
// (this file runs outside the build, so it can't import that).
if (process.env.SENTRY_DSN) {
    Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
        dataCollection: {
            userInfo: false,
            cookies: false,
            httpHeaders: false,
            httpBodies: [],
            urlQueryParams: false,
            databaseQueryData: false,
            queues: false,
            stackFrameVariables: false,
        },
        integrations: [Sentry.captureConsoleIntegration({ levels: ['error'] })],
    });
}

const build = (await import(pathToFileURL(resolve('build/server/index.js')).href)) as ServerBuild;

const app = express();
app.disable('x-powered-by');
// Use X-Forwarded-Proto / X-Forwarded-Host from the proxy for the request URL (see above).
app.set('trust proxy', true);
app.use(compression());
// Built assets have content hashes in their names, so they can be cached forever.
app.use('/assets', express.static('build/client/assets', { immutable: true, maxAge: '1y' }));
app.use(express.static('build/client', { maxAge: '1h' }));
// For the host's health check. It only says this server is running, without asking the API: a health
// check on a page that needs the API fails while the API sleeps, and the host then never lets visitors in.
app.get('/healthz', (_request, response) => {
    response.type('text/plain').send('ok');
});
// For an uptime monitor: is the whole shop up? Asks the API's health check, which also checks the database.
// Answers 503 when anything behind this server is down, without saying what (the monitor's alert is enough).
// The header lets the monitor tell this answer apart from a page the proxy or a login gate answers with.
const apiHealthUrl = new URL('/api/health', process.env.API_URL ?? 'http://localhost:3001');
app.get('/readyz', async (_request, response) => {
    const ready = await fetch(apiHealthUrl, { signal: AbortSignal.timeout(3000) }).then(
        (apiResponse) => {
            // Only the status matters; drop the body so the connection is freed now.
            void apiResponse.body?.cancel();
            return apiResponse.ok;
        },
        () => false,
    );
    response.set('Cache-Control', 'no-store');
    if (ready) {
        response.set('X-Pesoprint-Ready', '1').type('text/plain').send('ok');
    } else {
        response.status(503).type('text/plain').send('unavailable');
    }
});
app.use(morgan('tiny'));
app.all('/{*splat}', createRequestHandler({ build, mode: process.env.NODE_ENV }));

// A host that puts idle services to sleep wakes this server on the first visit; wake the API at the same
// time, so it's ready sooner. Nothing depends on the answer.
if (process.env.API_URL) {
    fetch(apiHealthUrl, { signal: AbortSignal.timeout(120_000) }).catch(() => {});
}

const port = Number(process.env.PORT ?? 3000);
const server = app.listen(port, () => {
    // oxlint-disable-next-line no-console -- the startup line in the host's log
    console.log(`Pesoprint web listening on http://localhost:${port}`);
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => server.close(() => void Sentry.flush(2000)));
}
