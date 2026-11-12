import { CLIENT_IP_HEADER, PROXY_SECRET_HEADER } from '@app/shared';
import type { LoaderFunctionArgs } from 'react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test';

import { requestDownload, visitorIp } from './downloads.server';

const SECRET = 'w'.repeat(32);
const FILE_ID = '0190b6a0-0000-7000-8000-000000000201';
const link = {
    url: 'https://r2.test/private/hook.stl?sig=1',
    filename: 'hook.stl',
    expiresAt: '2026-11-12T10:05:00.000Z',
};

const auth = vi.hoisted(() => ({ isAuthenticated: false }));
vi.mock('@clerk/react-router/server', () => ({
    getAuth: async () => ({ isAuthenticated: auth.isAuthenticated, getToken: async () => 'session-token' }),
}));
// The secret is read once, on first use; set it before anything reads the environment.
vi.stubEnv('INTERNAL_API_SECRET', SECRET);

function args(headers: Record<string, string> = {}): LoaderFunctionArgs {
    return {
        request: new Request('http://shop.test/models/hook/download/x', { headers }),
        params: {},
        context: {} as never,
    } as unknown as LoaderFunctionArgs;
}

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
    auth.isAuthenticated = false;
    fetchMock = vi.fn<typeof fetch>(async () => Response.json(link));
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

const sentHeaders = () => new Headers(fetchMock.mock.calls[0]![1]?.headers);

describe('visitorIp', () => {
    test("is the last X-Forwarded-For entry, the one the host's proxy added", () => {
        expect(visitorIp(new Request('http://x', { headers: { 'x-forwarded-for': '10.1.1.1, 203.0.113.7' } }))).toBe(
            '203.0.113.7',
        );
        expect(visitorIp(new Request('http://x', { headers: { 'x-forwarded-for': 'nonsense' } }))).toBeNull();
        expect(visitorIp(new Request('http://x'))).toBeNull();
    });
});

describe('requestDownload', () => {
    test("passes on a visitor's IP with the shared secret, without a session", async () => {
        await expect(requestDownload(args({ 'x-forwarded-for': '203.0.113.7' }), FILE_ID)).resolves.toEqual(link);

        const [url, init] = fetchMock.mock.calls[0]!;
        expect((url as URL).pathname).toBe(`/api/downloads/${FILE_ID}`);
        expect(init?.method).toBe('POST');
        expect(sentHeaders().get(CLIENT_IP_HEADER)).toBe('203.0.113.7');
        expect(sentHeaders().get(PROXY_SECRET_HEADER)).toBe(SECRET);
        expect(sentHeaders().has('authorization')).toBe(false);
    });

    test('sends the session of a signed-in visitor, so admins can download drafts', async () => {
        auth.isAuthenticated = true;
        await requestDownload(args(), FILE_ID);

        expect(sentHeaders().get('authorization')).toBe('Bearer session-token');
        // Locally there's no proxy, so no IP to pass on.
        expect(sentHeaders().has(CLIENT_IP_HEADER)).toBe(false);
    });
});
