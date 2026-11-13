import { isRouteErrorResponse } from 'react-router';

/**
 * The body of the 503 a page answers with when the API can't be reached: it's starting up (on a free
 * host it sleeps when idle), being deployed, or down. Error boundaries recognise it by this value.
 */
export const API_UNAVAILABLE = 'api_unavailable';

/** Seconds a client should wait before trying again (the Retry-After header). */
export const API_UNAVAILABLE_RETRY_SECONDS = 10;

export const isApiUnavailable = (error: unknown): boolean =>
    isRouteErrorResponse(error) && error.status === 503 && error.data === API_UNAVAILABLE;
