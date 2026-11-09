import { describe, expect, test } from 'vite-plus/test';

import { apiErrorSchema, healthResponseSchema } from '../src/index.ts';

describe('healthResponseSchema', () => {
    test('accepts a healthy response', () => {
        const parsed = healthResponseSchema.parse({
            status: 'ok',
            database: 'up',
            version: '0.0.0',
            uptimeSeconds: 12,
        });
        expect(parsed.status).toBe('ok');
    });

    test('rejects an unknown status', () => {
        const result = healthResponseSchema.safeParse({
            status: 'broken',
            database: 'up',
            version: '0.0.0',
            uptimeSeconds: 0,
        });
        expect(result.success).toBe(false);
    });
});

describe('apiErrorSchema', () => {
    test('accepts a validation error with issues', () => {
        const parsed = apiErrorSchema.parse({
            error: {
                code: 'validation_failed',
                message: 'Invalid request',
                issues: [{ path: 'title', message: 'Required' }],
            },
        });
        expect(parsed.error.issues).toHaveLength(1);
    });

    test('rejects an unknown error code', () => {
        expect(apiErrorSchema.safeParse({ error: { code: 'oops', message: 'x' } }).success).toBe(false);
    });
});
