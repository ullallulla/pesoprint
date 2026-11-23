import { describe, expect, test } from 'vite-plus/test';

import { loadEnv } from '../src/env.ts';

const base = { DATABASE_URL: 'postgres://u:p@localhost/db', CLERK_SECRET_KEY: 'sk_test_x' };

/** Everything production requires, on top of `base`. */
const production = {
    NODE_ENV: 'production',
    WEB_ORIGINS: 'https://shop.example.com',
    CLERK_WEBHOOK_SIGNING_SECRET: 'whsec_clerk',
    INTERNAL_API_SECRET: 'a'.repeat(64),
    IP_HASH_SECRET: 'b'.repeat(64),
    STRIPE_SECRET_KEY: 'sk_test_stripe',
    STRIPE_WEBHOOK_SECRET: 'whsec_stripe',
    RESEND_API_KEY: 're_key',
    SENTRY_DSN: 'https://key@o1.ingest.de.sentry.io/1',
    S3_ENDPOINT: 'https://account123.eu.r2.cloudflarestorage.com',
    S3_ACCESS_KEY_ID: 'key',
    S3_SECRET_ACCESS_KEY: 'secret',
    S3_PUBLIC_BUCKET: 'public',
    S3_PRIVATE_BUCKET: 'private',
    PUBLIC_ASSETS_URL: 'https://files.example.com',
};

describe('loadEnv', () => {
    test('treats empty values as not set', () => {
        // `EMAIL_REPLY_TO=` in a Docker env file is an empty string, which isn't an email address.
        const env = loadEnv({ ...base, EMAIL_REPLY_TO: '', INTERNAL_API_SECRET: '' });
        expect(env.EMAIL_REPLY_TO).toBeUndefined();
        expect(env.INTERNAL_API_SECRET).toBeUndefined();
    });

    test('accepts a complete production environment', () => {
        expect(loadEnv({ ...base, ...production })).toMatchObject({
            NODE_ENV: 'production',
            WEB_ORIGINS: ['https://shop.example.com'],
        });
    });

    test('in production, lists every missing setting at once', () => {
        const { STRIPE_WEBHOOK_SECRET: _, IP_HASH_SECRET: __, ...rest } = production;
        expect(() => loadEnv({ ...base, ...rest, RESEND_API_KEY: '' })).toThrow(
            'Required in production, but not set: IP_HASH_SECRET, STRIPE_WEBHOOK_SECRET, RESEND_API_KEY',
        );
    });

    test('in production, WEB_ORIGINS must be set instead of defaulting to localhost', () => {
        const { WEB_ORIGINS: _, ...rest } = production;
        expect(() => loadEnv({ ...base, ...rest })).toThrow(/not set: WEB_ORIGINS/);
    });

    test('reports missing and invalid settings together', () => {
        const { SENTRY_DSN: _, ...rest } = production;
        expect(() => loadEnv({ ...base, ...rest, STRIPE_SECRET_KEY: 'pk_live_wrong' })).toThrow(
            /not set: SENTRY_DSN[\s\S]*STRIPE_SECRET_KEY must start with/,
        );
    });

    test('outside production, those settings stay optional', () => {
        expect(loadEnv({ ...base, NODE_ENV: 'development' }).STRIPE_SECRET_KEY).toBeUndefined();
    });
});
