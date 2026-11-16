import {
    cartItemSchema,
    cartQuoteSchema,
    MAX_CART_ITEMS,
    type CartItem,
    type CartQuote,
    type OrderItemType,
} from '@app/shared';
import { getAuth } from '@clerk/react-router/server';
import { createCookie, data, redirect, type LoaderFunctionArgs } from 'react-router';
import { z } from 'zod';

import { apiFetch } from '~/lib/api.server';

/**
 * The cart is a cookie: what to buy, never prices (the API prices it on every view). Being a cookie rather
 * than localStorage, the server sees it, so the cart page and the header's count are in the first render.
 * It's needed for the cart to work at all, so it doesn't need consent, and it's only read by this site.
 */
export const CART_COOKIE = 'pesoprint_cart';
export const CART_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const cartCookie = createCookie(CART_COOKIE, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: CART_MAX_AGE_SECONDS,
});

const storedCartSchema = z.array(cartItemSchema).max(MAX_CART_ITEMS);

/** The cart in the request's cookie. A missing, old-format or tampered cookie is an empty cart. */
export async function readCart(request: Request): Promise<CartItem[]> {
    const value: unknown = await cartCookie.parse(request.headers.get('cookie')).catch(() => null);
    const parsed = storedCartSchema.safeParse(value);
    return parsed.success ? parsed.data : [];
}

/** A `Set-Cookie` header that stores `items`; an empty cart deletes the cookie. */
export function saveCart(request: Request, items: CartItem[]): Promise<string> {
    const secure = new URL(request.url).protocol === 'https:';
    return items.length === 0
        ? cartCookie.serialize('', { secure, maxAge: 0 })
        : cartCookie.serialize(items, { secure });
}

/**
 * The answer to a cart change: stores the cart and, for a plain form post (before the page's JavaScript
 * has loaded), redirects back to `page`. That post's own page would still show the old cart, since its
 * loaders read the cookie the request came with. With JavaScript, the page stays and its loaders run again.
 */
export async function cartChanged(request: Request, items: CartItem[], page: string) {
    const headers = { 'Set-Cookie': await saveCart(request, items) };
    return request.headers.get('sec-fetch-mode') === 'navigate'
        ? redirect(page, { headers })
        : data({ error: null }, { headers });
}

const sameItem = (a: CartItem, b: CartItem) => a.productId === b.productId && a.type === b.type;

export const isInCart = (items: CartItem[], item: CartItem) => items.some((entry) => sameItem(entry, item));

export type AddResult = { ok: true; items: CartItem[] } | { ok: false; reason: 'full' };

/** Adds an item once; adding it again changes nothing. */
export function addToCart(items: CartItem[], item: CartItem): AddResult {
    if (isInCart(items, item)) return { ok: true, items };
    if (items.length >= MAX_CART_ITEMS) return { ok: false, reason: 'full' };
    return { ok: true, items: [...items, item] };
}

export function removeFromCart(items: CartItem[], item: CartItem): CartItem[] {
    return items.filter((entry) => !sameItem(entry, item));
}

/** Prices the cart through the API, as the visitor: signed in, what they already own is left out. */
export async function quoteCart(args: LoaderFunctionArgs, items: CartItem[]): Promise<CartQuote> {
    const { isAuthenticated, getToken } = await getAuth(args);
    return apiFetch('/api/cart/quote', cartQuoteSchema, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items }),
        token: isAuthenticated ? await getToken() : null,
    });
}

/** Reads a cart item from a submitted form (`productId` and `type`); `null` if it isn't one. */
export function cartItemFromForm(form: FormData, type: OrderItemType = 'digital'): CartItem | null {
    const parsed = cartItemSchema.safeParse({ productId: form.get('productId'), type: form.get('type') ?? type });
    return parsed.success ? parsed.data : null;
}
