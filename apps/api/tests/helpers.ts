import type { NewUser } from '../src/db/schema.ts';
import type { AppOptions } from '../src/app.ts';
import { createApp } from '../src/app.ts';
import type { AuthContext } from '../src/lib/auth.ts';
import type { Bucket, Storage } from '../src/lib/storage.ts';
import type { CatalogService } from '../src/services/catalog.ts';
import type { CategoriesService } from '../src/services/categories.ts';
import type { DownloadsService } from '../src/services/downloads.ts';
import type { ProductMediaService } from '../src/services/product-media.ts';
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
        productMedia: unusedService<ProductMediaService>('productMedia'),
        catalog: unusedService<CatalogService>('catalog'),
        downloads: unusedService<DownloadsService>('downloads'),
        internalApiSecret: undefined,
        version: '1.2.3',
        startedAt: new Date(Date.now() - 5_000),
        logRequests: false,
        ...overrides,
    });
}

export const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

/**
 * In-memory storage. `simulateUpload()` stands in for the browser's PUT to the presigned URL;
 * `puts` and `deleted` record what the API uploaded and removed.
 */
export function createFakeStorage() {
    const objects = new Map<string, { sizeBytes: number; contentType: string; body?: Uint8Array }>();
    const deleted: string[] = [];
    const puts: string[] = [];
    const id = (bucket: Bucket, key: string) => `${bucket}:${key}`;

    const storage: Storage & {
        /** Pretends the browser uploaded a file. Pass `body` when the server will read the file. */
        simulateUpload(bucket: Bucket, key: string, sizeBytes: number, contentType: string, body?: Uint8Array): void;
        has(bucket: Bucket, key: string): boolean;
        deleted: string[];
        puts: string[];
    } = {
        deleted,
        puts,
        async presignUpload({ bucket, key, contentType }) {
            return {
                url: `https://storage.test/${bucket}/${key}?signature=fake`,
                headers: { 'content-type': contentType },
                expiresAt: new Date(Date.now() + 15 * 60_000),
            };
        },
        async get(bucket, key) {
            const object = objects.get(id(bucket, key));
            if (!object) return null;
            return object.body ?? new Uint8Array(object.sizeBytes);
        },
        async presignDownload({ bucket, key, filename, expiresInSeconds }) {
            const query = new URLSearchParams({ filename, expires: String(expiresInSeconds) });
            return `https://storage.test/${bucket}/${key}?${query.toString()}`;
        },
        async head(bucket, key) {
            const object = objects.get(id(bucket, key));
            return object ? { sizeBytes: object.sizeBytes, contentType: object.contentType } : null;
        },
        async put(bucket, key, body, contentType) {
            objects.set(id(bucket, key), { sizeBytes: body.byteLength, contentType, body });
            puts.push(id(bucket, key));
        },
        async delete(bucket, keys) {
            for (const key of keys) {
                objects.delete(id(bucket, key));
                deleted.push(id(bucket, key));
            }
        },
        publicUrl: (key) => `https://assets.test/${key}`,
        simulateUpload(bucket, key, sizeBytes, contentType, body) {
            objects.set(id(bucket, key), { sizeBytes, contentType, body });
        },
        has: (bucket, key) => objects.has(id(bucket, key)),
    };
    return storage;
}
