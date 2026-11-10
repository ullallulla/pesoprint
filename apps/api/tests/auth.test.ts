import { adminOverviewSchema, apiErrorSchema, meResponseSchema } from '@app/shared';
import { describe, expect, test } from 'vite-plus/test';

import { roleFromClaims } from '../src/lib/auth.ts';
import { bearer, buildApp, createFakeUsers, tokens } from './helpers.ts';

describe('GET /api/me', () => {
    test('401 without a token', async () => {
        const res = await buildApp().request('/api/me');

        expect(res.status).toBe(401);
        expect(apiErrorSchema.parse(await res.json()).error.code).toBe('unauthorized');
    });

    test('401 with an invalid token', async () => {
        const res = await buildApp().request('/api/me', bearer('forged'));

        expect(res.status).toBe(401);
        expect(apiErrorSchema.parse(await res.json()).error.message).toMatch(/invalid or has expired/);
    });

    test('401 when the header is not a bearer token', async () => {
        const res = await buildApp().request('/api/me', { headers: { authorization: tokens.customer } });
        expect(res.status).toBe(401);
    });

    test('returns the signed-in caller', async () => {
        const res = await buildApp().request('/api/me', bearer(tokens.customer));

        expect(res.status).toBe(200);
        expect(meResponseSchema.parse(await res.json())).toEqual({ userId: 'user_customer', role: 'customer' });
    });
});

describe('GET /api/admin/overview', () => {
    test('401 without a token', async () => {
        const res = await buildApp().request('/api/admin/overview');
        expect(res.status).toBe(401);
    });

    test('403 for a signed-in customer', async () => {
        const res = await buildApp().request('/api/admin/overview', bearer(tokens.customer));

        expect(res.status).toBe(403);
        expect(apiErrorSchema.parse(await res.json()).error.code).toBe('forbidden');
    });

    test('200 for an admin, with the user count', async () => {
        const users = createFakeUsers();
        await users.upsert({ id: 'user_a', email: 'a@example.com' });
        await users.upsert({ id: 'user_b', email: 'b@example.com' });

        const res = await buildApp({ users }).request('/api/admin/overview', bearer(tokens.admin));

        expect(res.status).toBe(200);
        expect(adminOverviewSchema.parse(await res.json())).toEqual({ userCount: 2 });
    });
});

describe('roleFromClaims', () => {
    test('reads the role from the metadata claim', () => {
        expect(roleFromClaims({ metadata: { role: 'admin' } })).toBe('admin');
    });

    test.each([
        ['no metadata claim', {}],
        ['empty metadata', { metadata: {} }],
        ['unknown role', { metadata: { role: 'superuser' } }],
        ['metadata is not an object', { metadata: 'admin' }],
    ])('falls back to customer: %s', (_, claims) => {
        expect(roleFromClaims(claims)).toBe('customer');
    });
});
