import { expect, test } from 'vite-plus/test';

import { ratingSummary, reviewAuthorName, reviewInputSchema } from '../src/reviews.ts';

test.each([
    ['Aino Korhonen', 'Aino K.'],
    ['  Aino   Maria  korhonen ', 'Aino K.'],
    ['Åsa Öberg', 'Åsa Ö.'],
    // A letter with a combining accent is one character to a reader.
    ['Zoe Élise', 'Zoe É.'],
    ['maker42', 'maker42'],
    ['', 'A customer'],
    [null, 'A customer'],
])('%j is shown as %j', (name, shown) => {
    expect(reviewAuthorName(name)).toBe(shown);
});

test('the average is rounded to one decimal, and there is none without ratings', () => {
    expect(ratingSummary(14, 3)).toEqual({ average: 4.7, count: 3 });
    expect(ratingSummary(5, 1)).toEqual({ average: 5, count: 1 });
    expect(ratingSummary(0, 0)).toBeNull();
});

test('a review is a whole number of stars from 1 to 5, and text is optional and trimmed', () => {
    expect(reviewInputSchema.parse({ rating: 4 })).toEqual({ rating: 4, body: '' });
    expect(reviewInputSchema.parse({ rating: 1, body: '  ok  ' })).toEqual({ rating: 1, body: 'ok' });
    for (const rating of [0, 6, 2.5, '3', null]) {
        expect(reviewInputSchema.safeParse({ rating }).success).toBe(false);
    }
});
