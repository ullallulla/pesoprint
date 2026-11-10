import type { UserJSON, WebhookEvent } from '@clerk/backend';
import { describe, expect, test } from 'vite-plus/test';

import { userFromClerk } from '../src/lib/clerk-user.ts';
import { buildApp, createFakeUsers } from './helpers.ts';

/** A Clerk user payload with only the fields we read; the rest of UserJSON is irrelevant here. */
function clerkUser(overrides: Partial<UserJSON> = {}): UserJSON {
    return {
        id: 'user_123',
        first_name: 'Ada',
        last_name: 'Lovelace',
        username: null,
        primary_email_address_id: 'idn_2',
        email_addresses: [
            { id: 'idn_1', email_address: 'old@example.com' },
            { id: 'idn_2', email_address: 'ada@example.com' },
        ],
        public_metadata: {},
        ...overrides,
    } as unknown as UserJSON;
}

function postWebhook(event: WebhookEvent | 'invalid', users = createFakeUsers()) {
    const app = buildApp({
        users,
        verifyClerkWebhook: async () => {
            if (event === 'invalid') {
                throw new Error('bad signature');
            }
            return event;
        },
    });
    const response = app.request('/api/webhooks/clerk', { method: 'POST', body: '{}' });
    return { response, users };
}

describe('POST /api/webhooks/clerk', () => {
    test('503 when no signing secret is configured', async () => {
        const res = await buildApp().request('/api/webhooks/clerk', { method: 'POST', body: '{}' });
        expect(res.status).toBe(503);
    });

    test('400 when the signature is invalid', async () => {
        const { response } = postWebhook('invalid');
        expect((await response).status).toBe(400);
    });

    test('user.created inserts the user', async () => {
        const { response, users } = postWebhook({
            type: 'user.created',
            data: clerkUser(),
        } as WebhookEvent);

        expect((await response).status).toBe(200);
        expect(users.rows.get('user_123')).toEqual({
            id: 'user_123',
            email: 'ada@example.com',
            displayName: 'Ada Lovelace',
            role: 'customer',
        });
    });

    test('user.updated syncs the admin role from public metadata', async () => {
        const { response, users } = postWebhook({
            type: 'user.updated',
            data: clerkUser({ public_metadata: { role: 'admin' } }),
        } as WebhookEvent);

        expect((await response).status).toBe(200);
        expect(users.rows.get('user_123')?.role).toBe('admin');
    });

    test('user.deleted removes the user', async () => {
        const users = createFakeUsers();
        await users.upsert({ id: 'user_123', email: 'ada@example.com' });

        const { response } = postWebhook(
            { type: 'user.deleted', data: { id: 'user_123', object: 'user', deleted: true } } as WebhookEvent,
            users,
        );

        expect((await response).status).toBe(200);
        expect(users.rows.has('user_123')).toBe(false);
    });

    test('other event types are acknowledged and ignored', async () => {
        const { response, users } = postWebhook({ type: 'session.created', data: {} } as WebhookEvent);

        expect((await response).status).toBe(200);
        expect(users.rows.size).toBe(0);
    });
});

describe('userFromClerk', () => {
    test('uses the primary email and full name', () => {
        expect(userFromClerk(clerkUser())).toMatchObject({ email: 'ada@example.com', displayName: 'Ada Lovelace' });
    });

    test('falls back to the username when there is no name', () => {
        const user = userFromClerk(clerkUser({ first_name: null, last_name: null, username: 'ada' }));
        expect(user?.displayName).toBe('ada');
    });

    test('returns null for users without an email address', () => {
        expect(userFromClerk(clerkUser({ email_addresses: [], primary_email_address_id: null }))).toBeNull();
    });
});
