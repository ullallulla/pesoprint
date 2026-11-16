import { expect, test } from 'vite-plus/test';

import { ApiRequestError } from './api.server';
import { isCartChanged } from './orders.server';

test('recognises a cart that changed since the buyer saw it', () => {
    const changed = new ApiRequestError('Your cart has changed.', 409, {
        code: 'conflict',
        message: 'Your cart has changed.',
        issues: [{ path: 'items', message: 'Your cart has changed.' }],
    });
    expect(isCartChanged(changed)).toBe(true);
});

test.each([
    ['another conflict', new ApiRequestError("Your account isn't ready yet.", 409, { code: 'conflict', message: '' })],
    [
        'another status',
        new ApiRequestError('Bad', 400, {
            code: 'validation_failed',
            message: '',
            issues: [{ path: 'items', message: '' }],
        }),
    ],
    ['not an API error', new Error('boom')],
])('%s is not a changed cart', (_, error) => {
    expect(isCartChanged(error)).toBe(false);
});
