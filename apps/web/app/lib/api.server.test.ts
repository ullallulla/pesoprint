import { healthResponseSchema } from '@app/shared';
import { afterEach, describe, expect, test, vi } from 'vite-plus/test';

import { apiFetch, ApiRequestError } from './api.server';

const baseUrl = 'http://api.test';
const healthy = { status: 'ok', database: 'up', version: '0.0.0', uptimeSeconds: 3 };

function mockFetch(status: number, body: unknown) {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json(body, { status }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('apiFetch', () => {
    test("gives up on an API that doesn't answer, instead of hanging the page", async () => {
        // The timeout has already run out; fetch rejects the way it does when its signal aborts.
        vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort(new DOMException('', 'TimeoutError')));
        vi.stubGlobal(
            'fetch',
            vi.fn<typeof fetch>(async (_url, init) => {
                throw init?.signal?.reason;
            }),
        );

        const error = await apiFetch('/api/health', healthResponseSchema, { baseUrl }).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ApiRequestError);
        expect(error).toMatchObject({ status: 504, message: 'API request timed out after 20 s: /api/health' });
    });

    test('returns parsed data for a valid response', async () => {
        const fetchMock = mockFetch(200, healthy);

        const result = await apiFetch('/api/health', healthResponseSchema, { baseUrl });

        expect(result).toEqual(healthy);
        expect(fetchMock).toHaveBeenCalledWith(new URL('/api/health', baseUrl), expect.anything());
    });

    test('parses accepted non-2xx statuses with the schema', async () => {
        mockFetch(503, { ...healthy, status: 'degraded', database: 'down' });

        const result = await apiFetch('/api/health', healthResponseSchema, { baseUrl, acceptStatuses: [503] });

        expect(result.status).toBe('degraded');
    });

    test('throws ApiRequestError with the API error details', async () => {
        mockFetch(404, { error: { code: 'not_found', message: 'No such model' } });

        const error = await apiFetch('/api/models/1', healthResponseSchema, { baseUrl }).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ApiRequestError);
        expect(error).toMatchObject({ status: 404, message: 'No such model', apiError: { code: 'not_found' } });
    });

    test('throws when the response does not match the schema', async () => {
        mockFetch(200, { unexpected: true });

        await expect(apiFetch('/api/health', healthResponseSchema, { baseUrl })).rejects.toThrow(
            'Unexpected response shape',
        );
    });
});
