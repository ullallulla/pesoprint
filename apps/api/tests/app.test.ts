import { apiErrorSchema, healthResponseSchema } from '@app/shared';
import { describe, expect, test } from 'vite-plus/test';

import { createApp } from '../src/app.ts';

function buildApp(databaseUp = true) {
    return createApp({
        checkDatabase: async () => databaseUp,
        version: '1.2.3',
        startedAt: new Date(Date.now() - 5_000),
        logRequests: false,
    });
}

describe('GET /api/health', () => {
    test('returns 200 and ok when the database is up', async () => {
        const res = await buildApp(true).request('/api/health');

        expect(res.status).toBe(200);
        const body = healthResponseSchema.parse(await res.json());
        expect(body).toMatchObject({ status: 'ok', database: 'up', version: '1.2.3' });
        expect(body.uptimeSeconds).toBeGreaterThanOrEqual(5);
    });

    test('returns 503 and degraded when the database is down', async () => {
        const res = await buildApp(false).request('/api/health');

        expect(res.status).toBe(503);
        expect(healthResponseSchema.parse(await res.json())).toMatchObject({
            status: 'degraded',
            database: 'down',
        });
    });

    test('sets a request id header', async () => {
        const res = await buildApp().request('/api/health');
        expect(res.headers.get('x-request-id')).toBeTruthy();
    });
});

describe('errors', () => {
    test('unknown routes return a 404 in the shared error format', async () => {
        const res = await buildApp().request('/api/does-not-exist');

        expect(res.status).toBe(404);
        const body = apiErrorSchema.parse(await res.json());
        expect(body.error.code).toBe('not_found');
        expect(body.error.requestId).toBeTruthy();
    });
});

describe('OpenAPI', () => {
    test('serves an OpenAPI 3.1 document that includes the health route', async () => {
        const res = await buildApp().request('/api/openapi.json');

        expect(res.status).toBe(200);
        const doc = (await res.json()) as { openapi: string; paths: Record<string, unknown> };
        expect(doc.openapi).toBe('3.1.0');
        expect(doc.paths).toHaveProperty('/api/health');
    });

    test('serves the interactive docs page', async () => {
        const res = await buildApp().request('/api/docs');

        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/html');
    });
});
