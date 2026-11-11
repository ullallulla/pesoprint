import type { NewUser } from '../src/db/schema.ts';
import type { AppOptions } from '../src/app.ts';
import { createApp } from '../src/app.ts';
import type { AuthContext } from '../src/lib/auth.ts';
import type { CategoriesService } from '../src/services/categories.ts';
import type { UsersService } from '../src/services/users.ts';

/** Tokens the fake verifier accepts. Anything else is rejected like an invalid Clerk token. */
export const tokens = {
    customer: 'customer-token',
    admin: 'admin-token',
} as const;

const callers: Record<string, AuthContext> = {
    [tokens.customer]: { userId: 'user_customer', sessionId: 'sess_1', role: 'customer' },
    [tokens.admin]: { userId: 'user_admin', sessionId: 'sess_2', role: 'admin' },
};

/** In-memory users service, so route tests don't need a database. */
export function createFakeUsers(): UsersService & { rows: Map<string, NewUser> } {
    const rows = new Map<string, NewUser>();
    return {
        rows,
        count: async () => rows.size,
        upsert: async (user) => {
            rows.set(user.id, user);
        },
        remove: async (id) => {
            rows.delete(id);
        },
    };
}

/** A categories service for tests that never reach it (auth, validation). Any call fails the test. */
const unusedCategories: CategoriesService = {
    list: () => Promise.reject(new Error('categories service not provided to buildApp')),
    create: () => Promise.reject(new Error('categories service not provided to buildApp')),
    update: () => Promise.reject(new Error('categories service not provided to buildApp')),
    remove: () => Promise.reject(new Error('categories service not provided to buildApp')),
};

export function buildApp(overrides: Partial<AppOptions> = {}) {
    return createApp({
        checkDatabase: async () => true,
        verifySessionToken: async (token) => {
            const caller = callers[token];
            if (!caller) {
                throw new Error('invalid token');
            }
            return caller;
        },
        verifyClerkWebhook: null,
        users: createFakeUsers(),
        categories: unusedCategories,
        version: '1.2.3',
        startedAt: new Date(Date.now() - 5_000),
        logRequests: false,
        ...overrides,
    });
}

export const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });
