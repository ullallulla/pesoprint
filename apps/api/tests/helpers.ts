import type { NewUser } from '../src/db/schema.ts';
import type { AppOptions } from '../src/app.ts';
import { createApp } from '../src/app.ts';
import type { AuthContext } from '../src/lib/auth.ts';
import type { CategoriesService } from '../src/services/categories.ts';
import type { ProductsService } from '../src/services/products.ts';
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

/**
 * A stand-in for a service the test never reaches (auth and validation tests stop before it).
 * Any call fails loudly, so a test that does reach it has to pass a real or fake service.
 */
function unusedService<T extends object>(name: string): T {
    return new Proxy({} as T, {
        get: (_, method) => () =>
            Promise.reject(new Error(`${name}.${String(method)}() called, but buildApp got no ${name} service`)),
    });
}

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
        categories: unusedService<CategoriesService>('categories'),
        products: unusedService<ProductsService>('products'),
        version: '1.2.3',
        startedAt: new Date(Date.now() - 5_000),
        logRequests: false,
        ...overrides,
    });
}

export const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });
