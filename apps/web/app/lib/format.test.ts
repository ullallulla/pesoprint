import { describe, expect, test } from 'vite-plus/test';

import { formatBytes, formatPrice, offerLines, plainExcerpt } from './format';

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
