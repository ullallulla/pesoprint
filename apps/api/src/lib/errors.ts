import type { ApiError, ApiErrorCode } from '@app/shared';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

const codeByStatus: Partial<Record<number, ApiErrorCode>> = {
    400: 'bad_request',
    401: 'unauthorized',
    403: 'forbidden',
    404: 'not_found',
    409: 'conflict',
    422: 'validation_failed',
    429: 'rate_limited',
};

export function errorCodeForStatus(status: number): ApiErrorCode {
    return codeByStatus[status] ?? (status >= 500 ? 'internal_error' : 'bad_request');
}

/**
 * Sends an error in the shared `ApiError` shape so every client can handle errors the same way.
 * The status stays a literal type (e.g. 503), so OpenAPI routes can check it against their documented responses.
 */
export function sendError<TStatus extends ContentfulStatusCode>(
    c: Context,
    status: TStatus,
    code: ApiErrorCode,
    message: string,
    issues?: NonNullable<ApiError['error']['issues']>,
) {
    const body: ApiError = {
        error: {
            code,
            message,
            ...(issues ? { issues } : {}),
            requestId: c.get('requestId'),
        },
    };
    return c.json(body, status);
}

type ErrorIssues = NonNullable<ApiError['error']['issues']>;

/**
 * An expected failure (not found, conflict, invalid input) thrown by a service.
 * The app's error handler turns it into an `ApiError` response, so services don't need the request context.
 */
export class AppError extends Error {
    readonly status: ContentfulStatusCode;
    readonly code: ApiErrorCode;
    readonly issues: ErrorIssues | undefined;

    constructor(status: ContentfulStatusCode, code: ApiErrorCode, message: string, issues?: ErrorIssues) {
        super(message);
        this.name = 'AppError';
        this.status = status;
        this.code = code;
        this.issues = issues;
    }
}

export const notFound = (message: string) => new AppError(404, 'not_found', message);
export const conflict = (message: string) => new AppError(409, 'conflict', message);
/** Input that passes the schema but breaks a business rule, reported against one field. */
export const invalidField = (path: string, message: string) =>
    new AppError(400, 'validation_failed', message, [{ path, message }]);
