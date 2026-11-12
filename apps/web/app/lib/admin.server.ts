import type { ApiErrorIssue } from '@app/shared';
import { getAuth } from '@clerk/react-router/server';
import { data, type LoaderFunctionArgs } from 'react-router';
import { z } from 'zod';

import { apiFetch, ApiRequestError, type ApiFetchOptions } from '~/lib/api.server';

/** What an admin form action returns: a confirmation, or what went wrong (per field where possible). */
export type ActionResult = { ok: true; message?: string } | { ok: false; message: string; issues: ApiErrorIssue[] };

/** For DELETE and other responses without a body. */
export const noContent = z.undefined();

type AdminArgs = Pick<LoaderFunctionArgs, 'request' | 'context' | 'params'>;

/**
 * Turns away requests that must not reach the admin API: visitors who aren't signed in (401), and
 * posts from other sites (403). React Router already refuses cross-site posts to page actions, but not
 * to resource routes such as the upload route; Clerk's `SameSite=Lax` session cookie is a third guard.
 * Returns the signed-in user's session token getter.
 */
export async function requireSession(args: AdminArgs) {
    const { request } = args;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        const origin = request.headers.get('origin');
        if (origin && origin !== 'null' && new URL(origin).host !== new URL(request.url).host) {
            throw data('Cross-site request refused', { status: 403 });
        }
    }
    const { isAuthenticated, getToken } = await getAuth(args as LoaderFunctionArgs);
    if (!isAuthenticated) {
        throw data('Sign in required', { status: 401 });
    }
    return getToken;
}

/**
 * Calls an admin API endpoint with the signed-in user's session token. The API decides whether the
 * user is an admin; its 401 and 403 become error responses that the admin layout's boundary shows.
 */
export async function adminApi<TSchema extends z.ZodType>(
    args: AdminArgs,
    path: string,
    schema: TSchema,
    { json, ...init }: Omit<ApiFetchOptions, 'token' | 'body'> & { json?: unknown } = {},
): Promise<z.output<TSchema>> {
    const getToken = await requireSession(args);

    const headers = new Headers(init.headers);
    if (json !== undefined) headers.set('content-type', 'application/json');

    try {
        return await apiFetch(path, schema, {
            ...init,
            headers,
            body: json === undefined ? undefined : JSON.stringify(json),
            token: await getToken(),
        });
    } catch (error) {
        if (error instanceof ApiRequestError && (error.status === 401 || error.status === 403)) {
            throw data(error.message, { status: error.status });
        }
        if (error instanceof ApiRequestError && error.status === 404 && init.method === undefined) {
            throw data(error.message, { status: 404 });
        }
        throw error;
    }
}

/**
 * Runs an admin action and turns the API's expected refusals (invalid input, conflicts, missing
 * storage) into an {@link ActionResult} for the form. Anything else is a real error and is rethrown.
 */
export async function runAction(action: () => Promise<string | undefined>): Promise<ActionResult> {
    try {
        const message = await action();
        return { ok: true, message };
    } catch (error) {
        if (error instanceof ApiRequestError && [400, 404, 409, 503].includes(error.status)) {
            return {
                ok: false,
                message:
                    error.status === 503
                        ? 'File storage is not configured on the API, so files cannot be uploaded.'
                        : error.message,
                issues: error.apiError?.issues ?? [],
            };
        }
        throw error;
    }
}

/** A form that failed validation before reaching the API. */
export function invalid(issues: ApiErrorIssue[], message = 'Check the highlighted fields.'): ActionResult {
    return { ok: false, message, issues };
}
