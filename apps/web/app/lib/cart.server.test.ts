import { MAX_CART_ITEMS, MAX_PRINT_LINES, MAX_PRINT_QUANTITY, type CartItem } from '@app/shared';
import { describe, expect, test } from 'vite-plus/test';

import {
    addToCart,
    CART_COOKIE,
    cartChanged,
    cartCount,
    cartItemFromForm,
    clearCheckout,
    isInCart,
    readCart,
    readCheckout,
    removeFromCart,
    saveCart,
    saveCheckout,
    setQuantity,
    withoutBought,
} from './cart.server';

const id = (n: number) => `0190b6a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const item = (n: number): CartItem => ({ productId: id(n), type: 'digital' });
/** A print of model `n` in material 800, in colour option `colour` (`null`: the colours shown). */
const print = (n: number, colour: number | null = 900, quantity = 1): CartItem => ({
    productId: id(n),
    type: 'print',
    materialId: id(800),
    colourOptionId: colour === null ? null : id(colour),
    quantity,
});

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

    test('a full cart with as many prints as allowed still fits in one cookie', async () => {
        const full = [
            ...Array.from({ length: MAX_PRINT_LINES }, (_, n) => print(n, 900 + n, MAX_PRINT_QUANTITY)),
            ...Array.from({ length: MAX_CART_ITEMS - MAX_PRINT_LINES }, (_, n) => item(100 + n)),
        ];
        const setCookie = await saveCart(new Request('https://shop.test/'), full);
        expect(setCookie.split(';')[0]!.length).toBeLessThan(4000);
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
        expect(addToCart(full, item(999))).toMatchObject({ ok: false, error: expect.stringContaining('full') });
        expect(addToCart(full, item(0))).toEqual({ ok: true, items: full });
    });

    test('the same print in the same colour adds copies, up to the most allowed; another colour is its own line', () => {
        expect(addToCart([print(1, 900, 2)], print(1, 900, 3))).toEqual({ ok: true, items: [print(1, 900, 5)] });
        expect(addToCart([print(1, 900, 8)], print(1, 900, 5))).toEqual({
            ok: true,
            items: [print(1, 900, MAX_PRINT_QUANTITY)],
        });
        expect(addToCart([print(1, 900)], print(1, 901))).toEqual({ ok: true, items: [print(1, 900), print(1, 901)] });
        // The file and a print of the same model are different things.
        expect(isInCart([print(1)], item(1))).toBe(false);
    });

    test(`at most ${MAX_PRINT_LINES} different prints`, () => {
        const prints = Array.from({ length: MAX_PRINT_LINES }, (_, n) => print(n, 900 + n));
        expect(addToCart(prints, print(99))).toMatchObject({ ok: false });
        expect(addToCart(prints, item(99))).toMatchObject({ ok: true });
    });

    test('sets the copies of one print, and counts every copy', () => {
        const items = [item(1), print(2, 900), print(2, 901)];
        const changed = setQuantity(items, print(2, 901, 4), 4);
        expect(changed).toEqual([item(1), print(2, 900), print(2, 901, 4)]);
        expect(cartCount(changed)).toBe(6);
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
        const printForm = (fields: Record<string, string>) =>
            form({ productId: id(1), type: 'print', materialId: id(800), ...fields });
        expect(cartItemFromForm(printForm({ colourOptionId: id(900), quantity: '3' }))).toEqual(print(1, 900, 3));
        expect(cartItemFromForm(printForm({ colourOptionId: id(900) }))).toEqual(print(1, 900));
        // A model without colour options: no colour, or an empty one.
        expect(cartItemFromForm(printForm({}))).toEqual(print(1, null));
        expect(cartItemFromForm(printForm({ colourOptionId: '' }))).toEqual(print(1, null));
        expect(cartItemFromForm(printForm({ colourOptionId: id(900), quantity: '11' }))).toBeNull();
        expect(cartItemFromForm(form({ productId: id(1), type: 'print', colourOptionId: id(900) }))).toBeNull();
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

describe('after a checkout is paid', () => {
    test('the checkout cookie remembers the order and what went into it, until cleared', async () => {
        const record = { orderId: id(500), items: [item(1), print(2, 900, 2)] };
        const setCookie = await saveCheckout(new Request('https://shop.test/checkout'), record);
        expect(setCookie).toContain('HttpOnly');
        expect(setCookie).toContain('SameSite=Lax');
        expect(await readCheckout(requestWith(setCookie))).toEqual(record);

        expect(await clearCheckout(new Request('https://shop.test/'))).toContain('Max-Age=0');
        expect(await readCheckout(new Request('https://shop.test/'))).toBeNull();
    });

    test('only what was bought leaves the cart: other colours and copies added since stay', () => {
        const cart = [item(1), item(3), print(2, 900, 3), print(2, 901, 1), print(4, null, 1)];
        const bought = [item(1), print(2, 900, 2), print(4, null, 1)];
        expect(withoutBought(cart, bought)).toEqual([item(3), print(2, 900, 1), print(2, 901, 1)]);
    });

    test('a cart that changed completely since is left as it is', () => {
        expect(withoutBought([item(7)], [item(1), print(2)])).toEqual([item(7)]);
    });
});
