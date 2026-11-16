import { MAX_CART_ITEMS, type CartItem } from '@app/shared';
import { describe, expect, test } from 'vite-plus/test';

import {
    addToCart,
    CART_COOKIE,
    cartChanged,
    cartItemFromForm,
    isInCart,
    readCart,
    removeFromCart,
    saveCart,
} from './cart.server';

const id = (n: number) => `0190b6a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const item = (n: number): CartItem => ({ productId: id(n), type: 'digital' });

/** A request carrying the cookie a `Set-Cookie` header stored. */
function requestWith(setCookie: string, url = 'https://shop.test/cart') {
    return new Request(url, { headers: { cookie: setCookie.split(';')[0]! } });
}

describe('cart cookie', () => {
    test('round-trips the items', async () => {
        const items = [item(1), item(2)];
        const setCookie = await saveCart(new Request('https://shop.test/'), items);
        expect(await readCart(requestWith(setCookie))).toEqual(items);
    });

    test('is first-party, hidden from scripts, kept for 30 days, and Secure over HTTPS', async () => {
        const setCookie = await saveCart(new Request('https://shop.test/'), [item(1)]);
        expect(setCookie).toMatch(new RegExp(`^${CART_COOKIE}=`));
        expect(setCookie).toContain('Path=/');
        expect(setCookie).toContain('HttpOnly');
        expect(setCookie).toContain('SameSite=Lax');
        expect(setCookie).toContain('Max-Age=2592000');
        expect(setCookie).toContain('Secure');

        const local = await saveCart(new Request('http://localhost:5173/'), [item(1)]);
        expect(local).not.toContain('Secure');
    });

    test('an empty cart deletes the cookie', async () => {
        const setCookie = await saveCart(new Request('https://shop.test/'), []);
        expect(setCookie).toContain('Max-Age=0');
    });

    test.each([
        ['no cookie', ''],
        ['not base64 JSON', `${CART_COOKIE}=%%%`],
        ['the wrong shape', `${CART_COOKIE}=${btoa(JSON.stringify({ productId: id(1) }))}`],
        [
            'a product id that is not a UUID',
            `${CART_COOKIE}=${btoa(JSON.stringify([{ productId: 'x', type: 'digital' }]))}`,
        ],
        [
            'too many items',
            `${CART_COOKIE}=${btoa(JSON.stringify(Array.from({ length: MAX_CART_ITEMS + 1 }, (_, n) => item(n))))}`,
        ],
    ])('%s reads as an empty cart', async (_, cookie) => {
        expect(await readCart(new Request('https://shop.test/', { headers: { cookie } }))).toEqual([]);
    });

    test('a full cart fits comfortably in one cookie', async () => {
        const full = Array.from({ length: MAX_CART_ITEMS }, (_, n) => item(n));
        const setCookie = await saveCart(new Request('https://shop.test/'), full);
        // Browsers drop cookies over 4096 bytes without a word.
        expect(setCookie.split(';')[0]!.length).toBeLessThan(3000);
        expect(await readCart(requestWith(setCookie))).toEqual(full);
    });
});

describe('cart changes', () => {
    test('adding an item twice keeps one', () => {
        const once = addToCart([], item(1));
        expect(once).toEqual({ ok: true, items: [item(1)] });
        expect(addToCart([item(1)], item(1))).toEqual({ ok: true, items: [item(1)] });
    });

    test('a full cart takes nothing more, but adding what is already in it is fine', () => {
        const full = Array.from({ length: MAX_CART_ITEMS }, (_, n) => item(n));
        expect(addToCart(full, item(999))).toEqual({ ok: false, reason: 'full' });
        expect(addToCart(full, item(0))).toEqual({ ok: true, items: full });
    });

    test('removes only the given item', () => {
        expect(removeFromCart([item(1), item(2), item(3)], item(2))).toEqual([item(1), item(3)]);
        expect(isInCart([item(1)], item(1))).toBe(true);
        expect(isInCart([item(1)], item(2))).toBe(false);
    });

    test('reads an item from a form, and nothing else', () => {
        const form = (entries: Record<string, string>) => {
            const data = new FormData();
            for (const [key, value] of Object.entries(entries)) data.set(key, value);
            return data;
        };
        expect(cartItemFromForm(form({ productId: id(1), type: 'digital' }))).toEqual(item(1));
        expect(cartItemFromForm(form({ productId: id(1) }))).toEqual(item(1));
        expect(cartItemFromForm(form({ productId: 'hook' }))).toBeNull();
        expect(cartItemFromForm(form({ productId: id(1), type: 'print' }))).toBeNull();
        expect(cartItemFromForm(form({}))).toBeNull();
    });
});

describe('cartChanged', () => {
    test('a plain form post is sent back to the page, with the new cart', async () => {
        const request = new Request('https://shop.test/models/hook', {
            method: 'POST',
            headers: { 'sec-fetch-mode': 'navigate' },
        });
        const response = await cartChanged(request, [item(1)], '/models/hook');
        expect(response).toBeInstanceOf(Response);
        const redirect = response as Response;
        expect(redirect.status).toBe(302);
        expect(redirect.headers.get('location')).toBe('/models/hook');
        expect(await readCart(requestWith(redirect.headers.get('set-cookie')!))).toEqual([item(1)]);
    });

    test('a request from the page’s JavaScript stays on the page', async () => {
        const request = new Request('https://shop.test/models/hook', {
            method: 'POST',
            headers: { 'sec-fetch-mode': 'cors' },
        });
        const response = await cartChanged(request, [item(1)], '/models/hook');
        expect(response).not.toBeInstanceOf(Response);
        expect(response).toMatchObject({ data: { error: null }, init: { headers: expect.any(Object) } });
    });
});
