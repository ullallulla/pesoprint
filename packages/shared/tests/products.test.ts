import { describe, expect, test } from 'vite-plus/test';

import {
    adminProductListQuerySchema,
    createProductSchema,
    licenseIssue,
    publishProblems,
    type PublishCheckInput,
} from '../src/index.ts';

const ready: PublishCheckInput = {
    categoryId: '0190a6d2-3b7e-7000-8000-000000000000',
    digitalPriceCents: 0,
    printBasePriceCents: null,
    license: 'cc_by',
    imageCount: 1,
    downloadFileCount: 1,
};

const paths = (product: PublishCheckInput) => publishProblems(product).map((issue) => issue.path);

describe('publishProblems', () => {
    test('a complete free download is ready', () => {
        expect(publishProblems(ready)).toEqual([]);
    });

    test('a print-only product needs no licence or download file', () => {
        expect(
            publishProblems({
                ...ready,
                digitalPriceCents: null,
                printBasePriceCents: 2500,
                license: null,
                downloadFileCount: 0,
            }),
        ).toEqual([]);
    });

    test('an empty draft lists every problem', () => {
        expect(
            paths({
                categoryId: null,
                digitalPriceCents: null,
                printBasePriceCents: null,
                license: null,
                imageCount: 0,
                downloadFileCount: 0,
            }),
        ).toEqual(['categoryId', 'digitalPriceCents', 'images']);
    });

    test('offering a file needs a licence and an uploaded file', () => {
        expect(paths({ ...ready, license: null, downloadFileCount: 0 })).toEqual(['license', 'files']);
    });

    test('a paid file under a CC licence is refused', () => {
        expect(paths({ ...ready, digitalPriceCents: 500 })).toEqual(['license']);
        expect(paths({ ...ready, digitalPriceCents: 500, license: 'standard_digital' })).toEqual([]);
    });
});

describe('licenseIssue', () => {
    test.each([
        ['free file, CC licence', 0, 'cc_by', false],
        ['free file, shop licence', 0, 'standard_digital', false],
        ['paid file, shop licence', 500, 'commercial', false],
        ['paid file, CC licence', 500, 'cc_by_nc', true],
        ['paid file, no licence yet', 500, null, false],
        ['no file, CC licence', null, 'gpl', false],
    ] as const)('%s', (_, digitalPriceCents, license, refused) => {
        expect(licenseIssue({ digitalPriceCents, license }) !== null).toBe(refused);
    });
});

describe('product request schemas', () => {
    test('create needs only slug and title', () => {
        expect(createProductSchema.parse({ slug: 'dragon', title: ' Dragon ' })).toEqual({
            slug: 'dragon',
            title: 'Dragon',
        });
        expect(createProductSchema.safeParse({ title: 'Dragon' }).success).toBe(false);
    });

    test('list query coerces numbers from the query string and applies defaults', () => {
        expect(adminProductListQuerySchema.parse({ page: '3' })).toEqual({ page: 3, pageSize: 20 });
        expect(adminProductListQuerySchema.safeParse({ pageSize: '500' }).success).toBe(false);
    });
});
