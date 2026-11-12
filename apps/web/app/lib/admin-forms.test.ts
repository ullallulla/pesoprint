import { LICENSE_IDS } from '@app/shared';
import { describe, expect, test } from 'vite-plus/test';

import { LICENSE_GROUPS } from '~/components/admin/licenses';

import {
    centsToEuros,
    fieldErrors,
    fileOfferOf,
    parseCategoryForm,
    parseEuros,
    parseNewProductForm,
    parseProductForm,
    reorderImages,
    slugify,
} from './admin-forms';

const formData = (fields: Record<string, string>) => {
    const form = new FormData();
    for (const [name, value] of Object.entries(fields)) form.set(name, value);
    return form;
};

describe('slugify', () => {
    test.each([
        ['Fidget Cube (v2)', 'fidget-cube-v2'],
        ['  Café   Stand  ', 'cafe-stand'],
        ['Yaesu FT-5 / Table stand!', 'yaesu-ft-5-table-stand'],
        ['---', ''],
    ])('%j → %j', (input, slug) => {
        expect(slugify(input)).toBe(slug);
    });

    test('stays within 100 characters without a trailing hyphen', () => {
        const slug = slugify(`${'a'.repeat(99)} b`);
        expect(slug).toBe('a'.repeat(99));
    });
});

describe('euro prices', () => {
    test.each([
        ['12', 1200],
        ['12.5', 1250],
        ['12,50', 1250],
        ['€ 4.05', 405],
        ['0', 0],
    ])('%j is %i cents', (input, cents) => {
        expect(parseEuros(input)).toBe(cents);
    });

    test.each(['', 'abc', '-1', '1.234', '1.2.3', '12e3'])('%j is not a price', (input) => {
        expect(parseEuros(input)).toBeNull();
    });

    test('cents back to an input value', () => {
        expect(centsToEuros(1250)).toBe('12.50');
        expect(centsToEuros(null)).toBe('');
    });

    test('the file offer keeps free (0) and not offered (null) apart', () => {
        expect([fileOfferOf(null), fileOfferOf(0), fileOfferOf(450)]).toEqual(['none', 'free', 'paid']);
    });
});

describe('parseProductForm', () => {
    const base = {
        title: ' Cable Clip ',
        slug: 'cable-clip',
        description: 'Line one\r\nLine two',
        categoryId: '',
        fileOffer: 'none',
        digitalPrice: '',
        printPrice: '',
        license: '',
        sizeXMm: '',
        sizeYMm: '',
        sizeZMm: '',
        printWeightG: '',
    };

    test('sends every field, with empty ones cleared', () => {
        const result = parseProductForm(formData(base));
        expect(result).toEqual({
            ok: true,
            data: {
                title: 'Cable Clip',
                slug: 'cable-clip',
                description: 'Line one\nLine two',
                categoryId: null,
                digitalPriceCents: null,
                printBasePriceCents: null,
                license: null,
                sizeXMm: null,
                sizeYMm: null,
                sizeZMm: null,
                printWeightG: null,
            },
        });
    });

    test('a free file is 0 cents and ignores the price field', () => {
        const result = parseProductForm(formData({ ...base, fileOffer: 'free', digitalPrice: '9.99' }));
        expect(result.ok && result.data.digitalPriceCents).toBe(0);
    });

    test('reads prices in euros, sizes and the licence', () => {
        const result = parseProductForm(
            formData({
                ...base,
                fileOffer: 'paid',
                digitalPrice: '4,50',
                offerPrint: 'on',
                printPrice: '12.90',
                license: 'standard_digital',
                sizeXMm: '20',
                sizeYMm: '15',
                sizeZMm: '12',
                printWeightG: '8',
            }),
        );
        expect(result.ok && result.data).toMatchObject({
            digitalPriceCents: 450,
            printBasePriceCents: 1290,
            license: 'standard_digital',
            sizeXMm: 20,
            printWeightG: 8,
        });
    });

    test('explains price mistakes in euros, once per field', () => {
        const result = parseProductForm(
            formData({ ...base, fileOffer: 'paid', digitalPrice: '', offerPrint: 'on', printPrice: 'lots' }),
        );
        expect(result.ok).toBe(false);
        const errors = fieldErrors(result.ok ? [] : result.issues);
        expect(errors).toEqual({
            digitalPriceCents: 'Enter the price of the file.',
            printBasePriceCents: 'Enter an amount in euros, like 4.50 (at most €10,000).',
        });
    });

    test('a paid file must cost something', () => {
        const result = parseProductForm(formData({ ...base, fileOffer: 'paid', digitalPrice: '0' }));
        expect(fieldErrors(result.ok ? [] : result.issues).digitalPriceCents).toMatch(/Choose "Free"/);
    });

    test('reports invalid fields with the API field names', () => {
        const result = parseProductForm(formData({ ...base, slug: 'Not A Slug', sizeXMm: '0', license: 'mine' }));
        expect(Object.keys(fieldErrors(result.ok ? [] : result.issues)).sort()).toEqual(['license', 'sizeXMm', 'slug']);
    });
});

describe('parseNewProductForm', () => {
    test('makes the slug from the title when it is left empty', () => {
        expect(parseNewProductForm(formData({ title: 'Wave Wall Hook', slug: '' }))).toEqual({
            ok: true,
            data: { title: 'Wave Wall Hook', slug: 'wave-wall-hook' },
        });
    });

    test('needs a title', () => {
        const result = parseNewProductForm(formData({ title: ' ', slug: '' }));
        expect(Object.keys(fieldErrors(result.ok ? [] : result.issues))).toContain('title');
    });
});

describe('parseCategoryForm', () => {
    test('fills in the slug and position, and clears empty optional fields', () => {
        expect(
            parseCategoryForm(formData({ name: 'Desk Organisers', slug: '', description: '', parentId: '' })),
        ).toEqual({
            ok: true,
            data: { name: 'Desk Organisers', slug: 'desk-organisers', description: null, parentId: null, position: 0 },
        });
    });

    test('rejects a negative position', () => {
        const result = parseCategoryForm(formData({ name: 'Toys', position: '-1' }));
        expect(Object.keys(fieldErrors(result.ok ? [] : result.issues))).toEqual(['position']);
    });
});

describe('reorderImages', () => {
    const images = [
        { id: 'a', position: 0 },
        { id: 'b', position: 2 },
        { id: 'c', position: 5 },
    ];

    test('makes an image the cover, renumbering the others (b already has position 2)', () => {
        expect(reorderImages(images, 'c', 'first')).toEqual([
            { id: 'c', position: 0 },
            { id: 'a', position: 1 },
        ]);
    });

    test('moves one step and only changes what differs', () => {
        expect(reorderImages(images, 'a', 'later')).toEqual([
            { id: 'b', position: 0 },
            { id: 'a', position: 1 },
            { id: 'c', position: 2 },
        ]);
        expect(
            reorderImages(
                [
                    { id: 'a', position: 0 },
                    { id: 'b', position: 1 },
                ],
                'a',
                'earlier',
            ),
        ).toEqual([]);
    });

    test('ignores an unknown image', () => {
        expect(reorderImages(images, 'zzz', 'first')).toEqual([]);
    });
});

test('the licence picker offers every licence exactly once', () => {
    const offered = LICENSE_GROUPS.flatMap((group) => group.ids);
    expect([...offered].sort()).toEqual([...LICENSE_IDS].sort());
});
