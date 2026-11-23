import { describe, expect, test } from 'vite-plus/test';

import { parseEnv } from './env.server';

/** Everything production requires. */
const production = {
    NODE_ENV: 'production',
    API_URL: 'http://api:3001',
    SITE_URL: 'https://shop.example.com/',
    INTERNAL_API_SECRET: 'a'.repeat(64),
    SENTRY_DSN: 'https://key@o1.ingest.de.sentry.io/1',
    VITE_CLERK_PUBLISHABLE_KEY: 'pk_live_x',
    CLERK_SECRET_KEY: 'sk_live_x',
};

describe('parseEnv', () => {
    test('accepts a complete production environment', () => {
        expect(parseEnv(production)).toMatchObject({
            SITE_URL: 'https://shop.example.com',
            API_URL: 'http://api:3001',
        });
    });

    test('in production, lists every missing setting at once', () => {
        const { SITE_URL: _, CLERK_SECRET_KEY: __, ...rest } = production;
        expect(() => parseEnv({ ...rest, INTERNAL_API_SECRET: '' })).toThrow(
            'Required in production, but not set: SITE_URL, INTERNAL_API_SECRET, CLERK_SECRET_KEY',
        );
    });

    test('catches swapped Clerk keys', () => {
        expect(() => parseEnv({ ...production, VITE_CLERK_PUBLISHABLE_KEY: 'sk_live_x' })).toThrow(
            /VITE_CLERK_PUBLISHABLE_KEY must start with pk_/,
        );
    });

    test('outside production, the defaults apply and empty values count as not set', () => {
        expect(parseEnv({ NODE_ENV: 'development', SITE_URL: '' })).toMatchObject({
            SITE_URL: 'http://localhost:5173',
            API_URL: 'http://localhost:3001',
        });
    });
});
