import { LICENSE_IDS } from '@app/shared';
import { describe, expect, test } from 'vite-plus/test';

import { LICENSE_GROUPS } from '~/components/admin/licenses';

import {
    centsToEuros,
    fieldErrors,
    fileOfferOf,
    parseCategoryForm,
    parseColourForm,
    parseMaterialForm,
    parseEuros,
    parseNewProductForm,
    parseProductForm,
    parseShipmentForm,
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
    const PLA = '0190b6a0-0000-7000-8000-000000000301';
    const PETG = '0190b6a0-0000-7000-8000-000000000302';
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
                printOptions: [],
                colourOptions: [],
                parcelSize: null,
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
                [`print:${PLA}`]: 'on',
                [`printPrice:${PLA}`]: '12.90',
                // Not ticked: the price is ignored.
                [`printPrice:${PETG}`]: '14.90',
                parcelSize: 'S',
                license: 'standard_digital',
                sizeXMm: '20',
                sizeYMm: '15',
                sizeZMm: '12',
                printWeightG: '8',
            }),
        );
        expect(result.ok && result.data).toMatchObject({
            digitalPriceCents: 450,
            printOptions: [{ materialId: PLA, priceCents: 1290 }],
            parcelSize: 'S',
            license: 'standard_digital',
            sizeXMm: 20,
            printWeightG: 8,
        });
    });

    test('explains price mistakes in euros, once per field', () => {
        const result = parseProductForm(
            formData({
                ...base,
                fileOffer: 'paid',
                digitalPrice: '',
                [`print:${PLA}`]: 'on',
                [`printPrice:${PLA}`]: 'lots',
            }),
        );
        expect(result.ok).toBe(false);
        const errors = fieldErrors(result.ok ? [] : result.issues);
        expect(errors).toEqual({
            digitalPriceCents: 'Enter the price of the file.',
            [`printPrice:${PLA}`]: 'Enter an amount in euros, like 4.50 (at most €10,000).',
        });
    });

    test('a ticked material needs a price above €0', () => {
        const empty = parseProductForm(formData({ ...base, [`print:${PLA}`]: 'on', [`printPrice:${PLA}`]: '' }));
        const zero = parseProductForm(formData({ ...base, [`print:${PETG}`]: 'on', [`printPrice:${PETG}`]: '0' }));
        expect(fieldErrors(empty.ok ? [] : empty.issues)).toEqual({
            [`printPrice:${PLA}`]: 'Enter the price of a print in this material.',
        });
        expect(fieldErrors(zero.ok ? [] : zero.issues)).toEqual({
            [`printPrice:${PETG}`]: 'A print costs more than €0.',
        });
    });

    test('colour options: each row of menus is one option, its chosen colours in order; empty rows are skipped', () => {
        const RED = '0190b6a0-0000-7000-8000-000000000311';
        const BLACK = '0190b6a0-0000-7000-8000-000000000312';
        const form = formData(base);
        for (const [row, value] of [
            ['0', RED],
            ['0', ''],
            ['0', BLACK],
            ['1', ''],
            ['2', BLACK],
        ] as const) {
            form.append(`colourOption:${row}`, value);
        }
        const result = parseProductForm(form);
        expect(result.ok && result.data.colourOptions).toEqual([{ colourIds: [RED, BLACK] }, { colourIds: [BLACK] }]);
        // No rows at all: printed in the colours shown.
        const none = parseProductForm(formData(base));
        expect(none.ok && none.data.colourOptions).toEqual([]);
    });

    test('a colour twice in an option, or the same option twice, is explained on its row', () => {
        const RED = '0190b6a0-0000-7000-8000-000000000311';
        const form = formData(base);
        form.append('colourOption:0', RED);
        form.append('colourOption:0', RED);
        form.append('colourOption:1', RED);
        form.append('colourOption:2', RED);
        const result = parseProductForm(form);
        expect(fieldErrors(result.ok ? [] : result.issues)).toEqual({
            'colourOption:0': 'Use each colour once in an option.',
            'colourOption:2': 'This option is already listed.',
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

describe('parseShipmentForm', () => {
    test('trims the carrier and drops spaces copied into the tracking number', () => {
        expect(parseShipmentForm(formData({ carrier: ' Posti ', trackingNumber: 'JJFI 6543 2100 ' }))).toEqual({
            ok: true,
            data: { status: 'shipped', carrier: 'Posti', trackingNumber: 'JJFI65432100' },
        });
    });

    test('needs both, and only letters, digits and dashes in the tracking number', () => {
        const missing = parseShipmentForm(formData({ carrier: '', trackingNumber: '' }));
        expect(fieldErrors(missing.ok ? [] : missing.issues)).toEqual({
            carrier: 'Enter the carrier.',
            trackingNumber: 'Enter the tracking number.',
        });
        const odd = parseShipmentForm(formData({ carrier: 'Posti', trackingNumber: 'JJFI/123' }));
        expect(fieldErrors(odd.ok ? [] : odd.issues)).toEqual({
            trackingNumber: 'Use only letters, digits and dashes.',
        });
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

describe('parseMaterialForm', () => {
    test('reads the active and multicolour boxes, defaults the position and clears an empty description', () => {
        expect(
            parseMaterialForm(
                formData({ name: ' PETG ', description: '', position: '', active: 'on', multicolour: 'on' }),
            ),
        ).toEqual({
            ok: true,
            data: { name: 'PETG', description: null, active: true, multicolour: true, position: 0 },
        });
        expect(parseMaterialForm(formData({ name: 'PLA', position: '2' }))).toMatchObject({
            ok: true,
            data: { active: false, multicolour: false, position: 2 },
        });
    });

    test('needs a name', () => {
        const result = parseMaterialForm(formData({ name: '' }));
        expect(Object.keys(fieldErrors(result.ok ? [] : result.issues))).toEqual(['name']);
    });
});

describe('parseColourForm', () => {
    test('lowercases the swatch and defaults the position', () => {
        expect(parseColourForm(formData({ name: 'Signal red', hex: '#FF0000', position: '1' }))).toEqual({
            ok: true,
            data: { name: 'Signal red', hex: '#ff0000', position: 1 },
        });
        expect(parseColourForm(formData({ name: 'Black', hex: '#000000' }))).toMatchObject({
            ok: true,
            data: { position: 0 },
        });
    });

    test('rejects a swatch that is not #rrggbb', () => {
        const result = parseColourForm(formData({ name: 'Red', hex: 'red' }));
        expect(fieldErrors(result.ok ? [] : result.issues)).toEqual({ hex: 'Use a colour like #1f6feb.' });
    });
});
