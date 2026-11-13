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
import compression from 'compression';
import express from 'express';
import morgan from 'morgan';
import type { ServerBuild } from 'react-router';

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
app.use(morgan('tiny'));
app.all('/{*splat}', createRequestHandler({ build, mode: process.env.NODE_ENV }));

// A host that puts idle services to sleep wakes this server on the first visit; wake the API at the same
// time, so it's ready sooner. Nothing depends on the answer.
if (process.env.API_URL) {
    fetch(new URL('/api/health', process.env.API_URL), { signal: AbortSignal.timeout(120_000) }).catch(() => {});
}

const port = Number(process.env.PORT ?? 3000);
const server = app.listen(port, () => {
    // oxlint-disable-next-line no-console -- the startup line in the host's log
    console.log(`Pesoprint web listening on http://localhost:${port}`);
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => server.close());
}
