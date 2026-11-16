import { checkoutStartSchema, orderSchema, type CheckoutRequest, type CheckoutStart, type Order } from '@app/shared';
import { getAuth } from '@clerk/react-router/server';
import { data, type LoaderFunctionArgs } from 'react-router';

import { apiFetch, ApiRequestError } from '~/lib/api.server';

/** Signed-in only: the caller checks that first. */
async function tokenFor(args: LoaderFunctionArgs): Promise<string | null> {
    const { isAuthenticated, getToken } = await getAuth(args);
    return isAuthenticated ? getToken() : null;
}

/** Creates the order and its Stripe Checkout Session. */
export async function startCheckout(args: LoaderFunctionArgs, request: CheckoutRequest): Promise<CheckoutStart> {
    return apiFetch('/api/checkout', checkoutStartSchema, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        token: await tokenFor(args),
    });
}

/** The cart changed since the buyer saw it (the API lists the problem under `items`). */
export const isCartChanged = (error: unknown) =>
    error instanceof ApiRequestError &&
    error.status === 409 &&
    (error.apiError?.issues ?? []).some((issue) => issue.path === 'items');

/** One of the visitor's orders; someone else's is a 404 page. */
export async function getOrder(args: LoaderFunctionArgs, orderId: string): Promise<Order> {
    try {
        return await apiFetch(`/api/orders/${encodeURIComponent(orderId)}`, orderSchema, {
            token: await tokenFor(args),
        });
    } catch (error) {
        if (error instanceof ApiRequestError && error.status === 404) throw data(null, { status: 404 });
        throw error;
    }
}
