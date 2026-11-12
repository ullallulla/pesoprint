import { categorySchema } from '@app/shared';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test';

import { adminApi, noContent, runAction } from './admin.server';
import { getEnv } from '~/env.server';

import { ApiRequestError } from './api.server';

const auth = vi.hoisted(() => ({ isAuthenticated: true }));
vi.mock('@clerk/react-router/server', () => ({
    getAuth: async () => ({ isAuthenticated: auth.isAuthenticated, getToken: async () => 'session-token' }),
}));

const category = {
    id: '0190b6a0-0000-7000-8000-000000000001',
    slug: 'toys',
    name: 'Toys',
    description: null,
    parentId: null,
    position: 0,
};

function args(init: RequestInit & { origin?: string } = {}) {
    const headers = new Headers(init.headers);
    if (init.origin) headers.set('origin', init.origin);
    return {
        request: new Request('http://shop.test/admin/categories', { ...init, headers }),
        context: {} as never,
        params: {},
    };
}

/** The HTTP status of what a loader or action threw with `data(…, { status })`. */
const thrownStatus = (promise: Promise<unknown>) =>
    promise.then(
        () => undefined,
        (error: { init?: ResponseInit }) => error.init?.status,
    );

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
const answer = (status: number, body?: unknown) =>
    fetchMock.mockResolvedValueOnce(
        body === undefined ? new Response(null, { status }) : Response.json(body, { status }),
    );

beforeEach(() => {
    auth.isAuthenticated = true;
    fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('adminApi', () => {
    test('sends the session token and a JSON body', async () => {
        answer(201, category);

        const result = await adminApi(
            args({ method: 'POST', origin: 'http://shop.test' }),
            '/api/admin/categories',
            categorySchema,
            { method: 'POST', json: { slug: 'toys', name: 'Toys' } },
        );

        expect(result).toEqual(category);
        const [url, init] = fetchMock.mock.calls[0]!;
        expect(url).toEqual(new URL('/api/admin/categories', getEnv().API_URL));
        const headers = new Headers(init?.headers);
        expect(headers.get('authorization')).toBe('Bearer session-token');
        expect(headers.get('content-type')).toBe('application/json');
        expect(init?.body).toBe('{"slug":"toys","name":"Toys"}');
    });

    test('accepts an empty 204 response', async () => {
        answer(204);
        await expect(
            adminApi(args({ method: 'POST' }), '/api/admin/categories/x', noContent, { method: 'DELETE' }),
        ).resolves.toBeUndefined();
    });

    test('refuses visitors who are not signed in, without calling the API', async () => {
        auth.isAuthenticated = false;
        expect(await thrownStatus(adminApi(args(), '/api/admin/categories', categorySchema))).toBe(401);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test('refuses a form posted from another site', async () => {
        expect(
            await thrownStatus(
                adminApi(
                    args({ method: 'POST', origin: 'https://evil.test' }),
                    '/api/admin/categories',
                    categorySchema,
                    {
                        method: 'POST',
                    },
                ),
            ),
        ).toBe(403);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test.each([401, 403])('passes on the API refusing the user (%i)', async (status) => {
        answer(status, { error: { code: 'forbidden', message: 'Admins only.' } });
        expect(await thrownStatus(adminApi(args(), '/api/admin/categories', categorySchema))).toBe(status);
    });

    test('a missing resource on a page load is a 404 page', async () => {
        answer(404, { error: { code: 'not_found', message: 'No product with this id.' } });
        expect(await thrownStatus(adminApi(args(), '/api/admin/products/x', categorySchema))).toBe(404);
    });
});

describe('runAction', () => {
    test('returns the success message', async () => {
        await expect(runAction(async () => 'Saved.')).resolves.toEqual({ ok: true, message: 'Saved.' });
    });

    test('turns the API refusing the change into field issues for the form', async () => {
        const issues = [{ path: 'slug', message: 'This slug is already taken.' }];
        const result = await runAction(async () => {
            throw new ApiRequestError('A product with the slug "x" already exists.', 409, {
                code: 'conflict',
                message: 'A product with the slug "x" already exists.',
                issues,
            });
        });
        expect(result).toEqual({ ok: false, message: 'A product with the slug "x" already exists.', issues });
    });

    test('explains missing file storage', async () => {
        const result = await runAction(async () => {
            throw new ApiRequestError('Storage is not configured.', 503);
        });
        expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/storage is not configured/) });
    });

    test('rethrows real failures, so the error page shows', async () => {
        const failure = new ApiRequestError('Internal error', 500);
        await expect(
            runAction(async () => {
                throw failure;
            }),
        ).rejects.toBe(failure);
    });
});
