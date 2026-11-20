import { isRouteErrorResponse, type ErrorResponse } from 'react-router';

/**
 * Marks the 503 a page answers with when the API can't be reached: it's starting up (on a free host it
 * sleeps when idle), being deployed, or down. Error boundaries recognise it by this value.
 */
export const API_UNAVAILABLE = 'api_unavailable';

/** Seconds a client should wait before trying again (the Retry-After header). */
export const API_UNAVAILABLE_RETRY_SECONDS = 10;

/** The body of that 503. */
export interface ApiUnavailable {
    reason: typeof API_UNAVAILABLE;
    /**
     * The API's public health check, for the visitor's browser to call (API_WAKE_URL). On Render's free plan,
     * requests from the web server don't wake a sleeping API (they get an instant 502), but a request from
     * outside Render does. Absent where the API isn't public or never sleeps.
     */
    wakeUrl?: string;
}

export const isApiUnavailable = (error: unknown): error is ErrorResponse & { data: ApiUnavailable } =>
    isRouteErrorResponse(error) &&
    error.status === 503 &&
    typeof error.data === 'object' &&
    error.data !== null &&
    (error.data as Partial<ApiUnavailable>).reason === API_UNAVAILABLE;
