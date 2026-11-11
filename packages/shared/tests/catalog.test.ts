import { describe, expect, test } from 'vite-plus/test';

import {
    createCategorySchema,
    digitalPriceCentsSchema,
    isFreeDownload,
    isPaidFile,
    offersFile,
    offersPrint,
    printBasePriceCentsSchema,
    slugSchema,
    updateCategorySchema,
} from '../src/index.ts';

describe('price helpers', () => {
    // The three file states must never be confused: `0` and `null` are both falsy in JS.
    test.each([
        ['no file', null, { offersFile: false, isFreeDownload: false, isPaidFile: false }],
        ['free download', 0, { offersFile: true, isFreeDownload: true, isPaidFile: false }],
        ['paid file', 500, { offersFile: true, isFreeDownload: false, isPaidFile: true }],
    ])('%s', (_, digitalPriceCents, expected) => {
        const product = { digitalPriceCents };
        expect({
            offersFile: offersFile(product),
            isFreeDownload: isFreeDownload(product),
            isPaidFile: isPaidFile(product),
        }).toEqual(expected);
    });

    test('offersPrint', () => {
        expect(offersPrint({ printBasePriceCents: null })).toBe(false);
        expect(offersPrint({ printBasePriceCents: 2500 })).toBe(true);
    });

    test('price schemas match the database rules', () => {
        expect(digitalPriceCentsSchema.safeParse(0).success).toBe(true);
        expect(digitalPriceCentsSchema.safeParse(-1).success).toBe(false);
        expect(digitalPriceCentsSchema.safeParse(4.5).success).toBe(false);
        expect(printBasePriceCentsSchema.safeParse(0).success).toBe(false);
        expect(printBasePriceCentsSchema.safeParse(null).success).toBe(true);
    });
});

describe('slugSchema', () => {
    test.each(['dragon', 'articulated-dragon', 'cable-clip-2'])('accepts %s', (slug) => {
        expect(slugSchema.safeParse(slug).success).toBe(true);
    });

    test.each(['', 'Dragon', 'cable clip', 'double--hyphen', '-leading', 'trailing-', 'ääkkönen'])(
        'rejects %j',
        (slug) => {
            expect(slugSchema.safeParse(slug).success).toBe(false);
        },
    );
});

describe('category input', () => {
    test('trims the name and accepts optional fields', () => {
        const parsed = createCategorySchema.parse({ slug: 'toys', name: '  Toys  ' });
        expect(parsed).toEqual({ slug: 'toys', name: 'Toys' });
    });

    test('rejects an empty name and a parentId that is not a UUID', () => {
        expect(createCategorySchema.safeParse({ slug: 'toys', name: '   ' }).success).toBe(false);
        expect(createCategorySchema.safeParse({ slug: 'toys', name: 'Toys', parentId: '42' }).success).toBe(false);
    });

    test('update allows clearing the parent and description', () => {
        expect(updateCategorySchema.parse({ parentId: null, description: null })).toEqual({
            parentId: null,
            description: null,
        });
    });
});
