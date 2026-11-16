import { describe, expect, test } from 'vite-plus/test';

import { formatBytes, formatCount, formatDate, formatPrice, offerLines, plainExcerpt } from './format';

describe('formatPrice', () => {
    test.each([
        [0, '€0.00'],
        [450, '€4.50'],
        [249_000, '€2,490.00'],
    ])('%i cents → %s', (cents, expected) => {
        expect(formatPrice(cents)).toBe(expected);
    });
});

describe('offerLines', () => {
    test('free file plus print', () => {
        expect(offerLines({ digitalPriceCents: 0, printBasePriceCents: 2490 }).map((line) => line.label)).toEqual([
            'Free download',
            'Print from €24.90',
        ]);
    });

    test('paid file only', () => {
        expect(offerLines({ digitalPriceCents: 450, printBasePriceCents: null })).toEqual([
            { kind: 'file', label: 'File €4.50' },
        ]);
    });

    test('print only: no file line, even though 0 and null are both falsy', () => {
        expect(offerLines({ digitalPriceCents: null, printBasePriceCents: 990 }).map((line) => line.kind)).toEqual([
            'print',
        ]);
    });
});

test("formatDate shows the shop's local date, whatever the time zone of the server", () => {
    expect(formatDate('2026-11-16T12:00:00.000Z')).toBe('16 Nov 2026');
    // 23:30 UTC is already the next day in Helsinki.
    expect(formatDate('2026-11-16T23:30:00.000Z')).toBe('17 Nov 2026');
});

test('formatBytes', () => {
    expect([formatBytes(512), formatBytes(2048), formatBytes(5_000_000), formatBytes(3 * 1024 ** 3)]).toEqual([
        '512 B',
        '2.0 KB',
        '4.8 MB',
        '3.0 GB',
    ]);
});

describe('plainExcerpt', () => {
    test('strips markdown syntax', () => {
        expect(plainExcerpt('## Print settings\n\n- **Layer** height: 0.2 mm\n- See [the guide](https://x.test)')).toBe(
            'Print settings Layer height: 0.2 mm See the guide',
        );
    });

    test('cuts long text at a word boundary', () => {
        const excerpt = plainExcerpt('word '.repeat(100), 40);
        expect(excerpt.length).toBeLessThanOrEqual(40);
        expect(excerpt).toMatch(/word…$/);
    });

    test('keeps short text as it is', () => {
        expect(plainExcerpt('A desk stand.')).toBe('A desk stand.');
    });
});

test.each([
    [0, '0'],
    [950, '950'],
    [1234, '1.2K'],
    [15_000, '15K'],
    [2_500_000, '2.5M'],
])('formatCount(%i) → %s', (count, text) => {
    expect(formatCount(count)).toBe(text);
});
