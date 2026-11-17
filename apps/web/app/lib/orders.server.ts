import {
    checkoutStartSchema,
    orderListSchema,
    orderSchema,
    type CheckoutRequest,
    type CheckoutStart,
    type Order,
    type OrderList,
} from '@app/shared';
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

/** One page of the visitor's orders, newest first. `null` for a visitor who isn't signed in. */
export async function listOrders(args: LoaderFunctionArgs, page: number, pageSize: number): Promise<OrderList | null> {
    const token = await tokenFor(args);
    if (!token) return null;
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    return apiFetch(`/api/orders?${query}`, orderListSchema, { token });
}
