import { describe, expect, test } from 'vite-plus/test';

import { formatVatRate, vatIncludedCents } from '../src/index.ts';

describe('vatIncludedCents', () => {
    test.each([
        // gross, rate, VAT: net = gross / (1 + rate), rounded to the cent
        [450, 2550, 91], // 358.57 → 359
        [1740, 2550, 354], // 1386.45 → 1386
        [100, 2550, 20], // 79.68 → 80
        [1, 2550, 0], // 0.797 → 1
        [0, 2550, 0],
        [1000, 2400, 194], // 806.45 → 806
        [1000, 0, 0],
    ])('%i cents at %i bp contains %i cents of VAT', (gross, rate, vat) => {
        expect(vatIncludedCents(gross, rate)).toBe(vat);
    });

    test('is always within half a cent of the exact VAT', () => {
        for (let gross = 0; gross <= 5000; gross += 7) {
            const exact = (gross * 2550) / 12_550;
            expect(Math.abs(vatIncludedCents(gross, 2550) - exact)).toBeLessThanOrEqual(0.5);
        }
    });

    test.each([
        [-1, 2550],
        [4.5, 2550],
        [450, -1],
        [450, 10_000],
        [450, 25.5],
    ])('refuses %d cents at %d bp', (gross, rate) => {
        expect(() => vatIncludedCents(gross, rate)).toThrow(RangeError);
    });
});

test.each([
    [2550, '25.5 %'],
    [2400, '24 %'],
    [1000, '10 %'],
])('formatVatRate(%i) is %s', (rate, text) => {
    expect(formatVatRate(rate)).toBe(text);
});
