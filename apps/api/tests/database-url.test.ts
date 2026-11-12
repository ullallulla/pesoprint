import { describe, expect, test } from 'vite-plus/test';

import { describeDatabaseUrl, isLocalDatabaseUrl } from '../src/lib/database-url.ts';

describe('isLocalDatabaseUrl', () => {
    test.each([
        'postgres://pesoprint:pesoprint@localhost:5432/pesoprint',
        'postgresql://u:p@127.0.0.1/db',
        'postgres://u:p@[::1]:5432/db',
        'postgres://u:p@db.localhost/db',
    ])('%s is local', (url) => {
        expect(isLocalDatabaseUrl(url)).toBe(true);
    });

    test.each([
        'postgresql://u:p@ep-cool-name-123456-pooler.eu-central-1.aws.neon.tech/pesoprint?sslmode=require',
        'postgres://u:p@localhost.evil.test/db',
        'not a url',
    ])('%s is remote', (url) => {
        expect(isLocalDatabaseUrl(url)).toBe(false);
    });
});

test('describeDatabaseUrl never shows the password or options', () => {
    expect(describeDatabaseUrl('postgresql://user:s3cret@ep-x-pooler.neon.tech/pesoprint?sslmode=require')).toBe(
        'ep-x-pooler.neon.tech/pesoprint',
    );
    expect(describeDatabaseUrl('garbage')).toBe('(unreadable database URL)');
});
