import { CLIENT_IP_HEADER, PROXY_SECRET_HEADER } from '@app/shared';
import { describe, expect, test } from 'vite-plus/test';

import type { AuthContext } from '../src/lib/auth.ts';
import { clientIp, createIpHasher } from '../src/lib/client-ip.ts';
import { attachmentDisposition } from '../src/lib/storage.ts';
import { canDownload } from '../src/services/downloads.ts';

const SECRET = 'x'.repeat(32);
const admin: AuthContext = { userId: 'user_admin', sessionId: 's1', role: 'admin' };
const creator: AuthContext = { userId: 'user_creator', sessionId: 's2', role: 'creator' };
const customer: AuthContext = { userId: 'user_customer', sessionId: 's3', role: 'customer' };

describe('canDownload', () => {
    const product = (status: 'draft' | 'published' | 'archived', digitalPriceCents: number | null) => ({
        status,
        digitalPriceCents,
        creatorId: 'user_creator',
    });

    test.each([
        ['a free published model', product('published', 0), undefined, true],
        ['a free published model, signed in', product('published', 0), customer, true],
        ['a free draft', product('draft', 0), customer, false],
        ['a free archived model', product('archived', 0), undefined, false],
        ['a paid file (until checkout exists)', product('published', 450), customer, false],
        ['a model whose file is not offered', product('published', null), undefined, false],
        ['a paid draft, as admin', product('draft', 450), admin, true],
        ['an archived model, as its creator', product('archived', 0), creator, true],
    ] as const)('%s → %s', (_name, model, caller, allowed) => {
        expect(canDownload(model, caller)).toBe(allowed);
    });
});

describe('clientIp', () => {
    const headers = (entries: Record<string, string>) => new Headers(entries);

    test("trusts the web server's header only with the shared secret", () => {
        const fromWeb = headers({ [CLIENT_IP_HEADER]: '203.0.113.7', [PROXY_SECRET_HEADER]: SECRET });
        expect(clientIp(fromWeb, SECRET)).toBe('203.0.113.7');

        const forged = headers({
            [CLIENT_IP_HEADER]: '203.0.113.7',
            [PROXY_SECRET_HEADER]: 'y'.repeat(32),
            'x-forwarded-for': '198.51.100.1',
        });
        expect(clientIp(forged, SECRET)).toBe('198.51.100.1');
        // Without a secret configured, the header means nothing.
        expect(clientIp(fromWeb, undefined)).toBeNull();
    });

    test("uses the last X-Forwarded-For entry: the one the host's proxy added", () => {
        expect(clientIp(headers({ 'x-forwarded-for': '10.0.0.1, 192.0.2.44' }), undefined)).toBe('192.0.2.44');
        expect(clientIp(headers({ 'x-forwarded-for': '2001:db8::1' }), undefined)).toBe('2001:db8::1');
        expect(clientIp(headers({ 'x-forwarded-for': 'not-an-ip' }), undefined)).toBeNull();
        expect(clientIp(headers({}), undefined)).toBeNull();
    });
});

describe('createIpHasher', () => {
    const day1 = new Date('2026-11-12T08:00:00Z');
    const laterDay1 = new Date('2026-11-12T23:59:00Z');
    const day2 = new Date('2026-11-13T00:01:00Z');

    test('is stable within a day, changes the next day, and hides the address', () => {
        const hash = createIpHasher(SECRET);
        const first = hash('203.0.113.7', day1);
        expect(first).toMatch(/^[0-9a-f]{32}$/);
        expect(first).not.toContain('203');
        expect(hash('203.0.113.7', laterDay1)).toBe(first);
        expect(hash('203.0.113.7', day2)).not.toBe(first);
        expect(hash('203.0.113.8', day1)).not.toBe(first);
    });

    test('depends on the secret, and an unknown IP stays unknown', () => {
        expect(createIpHasher(SECRET)('203.0.113.7', day1)).not.toBe(
            createIpHasher('z'.repeat(32))('203.0.113.7', day1),
        );
        expect(createIpHasher(SECRET)(null, day1)).toBeNull();
    });
});

test('attachmentDisposition keeps the real name and an ASCII fallback', () => {
    expect(attachmentDisposition('hook.stl')).toBe(`attachment; filename="hook.stl"; filename*=UTF-8''hook.stl`);
    expect(attachmentDisposition('Käsikoukku "v2".3mf')).toBe(
        `attachment; filename="K_sikoukku _v2_.3mf"; filename*=UTF-8''K%C3%A4sikoukku%20%22v2%22.3mf`,
    );
});
