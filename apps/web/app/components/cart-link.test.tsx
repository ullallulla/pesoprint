import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { expect, test } from 'vite-plus/test';

import { CartLink } from './cart-link';

const render = (count: number) =>
    renderToStaticMarkup(
        <MemoryRouter>
            <CartLink count={count} />
        </MemoryRouter>,
    );

test.each([
    [0, 'Cart, empty'],
    [1, 'Cart, 1 item'],
    [3, 'Cart, 3 items'],
])('with %i items it is labelled "%s"', (count, label) => {
    expect(render(count)).toContain(`aria-label="${label}"`);
});

test('shows the count only when there is something in the cart', () => {
    expect(render(0)).not.toMatch(/>0</);
    expect(render(2)).toMatch(/>2<\/span>/);
});
