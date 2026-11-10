import { apiErrorSchema, type ApiError } from '@app/shared';
import type { z } from 'zod';

import { getEnv } from '~/env.server';

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

export interface ApiFetchOptions extends RequestInit {
    /** HTTP statuses (besides 2xx) whose body should still be parsed with the schema, e.g. 503 from /health. */
    acceptStatuses?: number[];
    /** Override the API base URL (used in tests). */
    baseUrl?: string;
    /** Clerk session token of the signed-in user; sent as `Authorization: Bearer <token>`. */
    token?: string | null;
}

/**
 * Calls the Pesoprint API from the web server and validates the response with a shared zod schema,
 * so loaders get typed, trusted data instead of `any`.
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
    const response = await fetch(url, { ...init, headers });

    const body: unknown = await response.json().catch(() => undefined);

    if (!response.ok && !acceptStatuses.includes(response.status)) {
        const parsedError = apiErrorSchema.safeParse(body);
        const apiError = parsedError.success ? parsedError.data.error : undefined;
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
