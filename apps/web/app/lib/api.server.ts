import { apiErrorSchema, type ApiError } from '@app/shared';
import { data } from 'react-router';
import type { z } from 'zod';

import { getEnv } from '~/env.server';
import { API_UNAVAILABLE, API_UNAVAILABLE_RETRY_SECONDS } from '~/lib/api-unavailable';

/** Thrown when the API answers with an error, or with a body that doesn't match the expected schema. */
export class ApiRequestError extends Error {
    readonly status: number;
    readonly apiError: ApiError['error'] | undefined;

    constructor(message: string, status: number, apiError?: ApiError['error']) {
        super(message);
        this.name = 'ApiRequestError';
        this.status = status;
        this.apiError = apiError;
    }
}

/** Longer than any normal answer, but a page never waits minutes for an API that isn't there. */
export const API_TIMEOUT_MS = 20_000;

export interface ApiFetchOptions extends RequestInit {
    /** HTTP statuses (besides 2xx) whose body should still be parsed with the schema, e.g. 503 from /health. */
    acceptStatuses?: number[];
    /** Override the API base URL (used in tests). */
    baseUrl?: string;
    /** Clerk session token of the signed-in user; sent as `Authorization: Bearer <token>`. */
    token?: string | null;
}

/** Statuses a proxy in front of the API answers with when there's no API behind it to answer. */
const GATEWAY_STATUSES = [502, 503, 504];

/**
 * The API couldn't be reached: the page answers 503, and the error boundaries show "starting up" and try
 * again. It's thrown as a response rather than an ApiRequestError so that it reaches the boundary as it is,
 * past every caller's handling of the API's own errors.
 */
function apiUnavailable(reason: string): never {
    console.warn(`API unavailable: ${reason}`);
    throw data(API_UNAVAILABLE, {
        status: 503,
        headers: { 'Retry-After': String(API_UNAVAILABLE_RETRY_SECONDS) },
    });
}

/**
 * Calls the Pesoprint API from the web server and validates the response with a shared zod schema,
 * so loaders get typed, trusted data instead of `any`. If the API can't be reached (no answer, a timeout,
 * or a gateway error from the host's proxy), it throws a 503 "API unavailable" response.
 */
export async function apiFetch<TSchema extends z.ZodType>(
    path: string,
    schema: TSchema,
    { acceptStatuses = [], baseUrl, token, ...init }: ApiFetchOptions = {},
): Promise<z.output<TSchema>> {
    const url = new URL(path, baseUrl ?? getEnv().API_URL);
    const headers = new Headers(init.headers);
    if (!headers.has('accept')) {
        headers.set('accept', 'application/json');
    }
    if (token) {
        headers.set('authorization', `Bearer ${token}`);
    }
    const timeout = AbortSignal.timeout(API_TIMEOUT_MS);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    let response: Response;
    try {
        response = await fetch(url, { ...init, headers, signal });
    } catch (error) {
        // The caller's own signal (e.g. the visitor left the page) is not the API's fault.
        if (init.signal?.aborted) throw error;
        if (timeout.aborted) apiUnavailable(`no answer within ${API_TIMEOUT_MS / 1000} s: ${url.pathname}`);
        // fetch fails with a TypeError when it can't connect; the cause says why (e.g. ECONNREFUSED).
        if (error instanceof TypeError) {
            apiUnavailable(`${error.cause instanceof Error ? error.cause.message : error.message}: ${url.pathname}`);
        }
        throw error;
    }

    const body: unknown = await response.json().catch(() => undefined);

    if (!response.ok && !acceptStatuses.includes(response.status)) {
        const parsedError = apiErrorSchema.safeParse(body);
        const apiError = parsedError.success ? parsedError.data.error : undefined;
        // Our API always explains its errors. A gateway status without that came from the proxy instead.
        if (!apiError && GATEWAY_STATUSES.includes(response.status)) {
            apiUnavailable(`${response.status} from ${url.pathname}`);
        }
        throw new ApiRequestError(
            apiError?.message ?? `API request failed: ${response.status} ${url.pathname}`,
            response.status,
            apiError,
        );
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
        throw new ApiRequestError(`Unexpected response shape from ${url.pathname}`, response.status);
    }
    return parsed.data;
}
