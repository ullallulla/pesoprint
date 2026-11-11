import { z } from 'zod';

import type { ApiErrorIssue } from './errors.ts';
import { isOwnLicense, licenseSchema, type License } from './licenses.ts';
import {
    digitalPriceCentsSchema,
    isPaidFile,
    offersFile,
    offersPrint,
    printBasePriceCentsSchema,
    type ProductOffers,
} from './pricing.ts';
import { slugSchema } from './slug.ts';

// The database enums are built from these tuples, so changing one needs a migration.
export const PRODUCT_STATUSES = ['draft', 'published', 'archived'] as const;
export const PRODUCT_FILE_KINDS = ['download', 'preview'] as const;
export const PRODUCT_FILE_FORMATS = ['stl', '3mf', 'step', 'obj', 'glb'] as const;

export const productStatusSchema = z.enum(PRODUCT_STATUSES);
export type ProductStatus = z.infer<typeof productStatusSchema>;
export const productFileKindSchema = z.enum(PRODUCT_FILE_KINDS);
export type ProductFileKind = z.infer<typeof productFileKindSchema>;
export const productFileFormatSchema = z.enum(PRODUCT_FILE_FORMATS);
export type ProductFileFormat = z.infer<typeof productFileFormatSchema>;

// ---------------------------------------------------------------------------
// Admin: requests

const millimetresSchema = z.int().min(1).max(10_000).nullable();

const productInputFields = z.object({
    slug: slugSchema,
    title: z.string().trim().min(1).max(200),
    /** Markdown. */
    description: z.string().max(20_000),
    categoryId: z.uuid().nullable(),
    digitalPriceCents: digitalPriceCentsSchema,
    printBasePriceCents: printBasePriceCentsSchema,
    license: licenseSchema.nullable(),
    sizeXMm: millimetresSchema,
    sizeYMm: millimetresSchema,
    sizeZMm: millimetresSchema,
    printWeightG: z.int().min(1).max(100_000).nullable(),
});

/** New products always start as drafts; only slug and title are needed. */
export const createProductSchema = productInputFields
    .partial()
    .extend({ slug: productInputFields.shape.slug, title: productInputFields.shape.title })
    .meta({ id: 'CreateProduct' });
export type CreateProduct = z.infer<typeof createProductSchema>;

/** Only the fields that are present change; `null` clears a field. The slug is locked once published. */
export const updateProductSchema = productInputFields.partial().meta({ id: 'UpdateProduct' });
export type UpdateProduct = z.infer<typeof updateProductSchema>;

export const adminProductListQuerySchema = z.object({
    status: productStatusSchema.optional(),
    categoryId: z.uuid().optional(),
    /** Matches part of the title or slug. */
    q: z.string().trim().min(1).max(100).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type AdminProductListQuery = z.infer<typeof adminProductListQuerySchema>;

// ---------------------------------------------------------------------------
// Admin: responses

const timestampSchema = z.iso.datetime();

export const adminProductSummarySchema = z
    .object({
        id: z.uuid(),
        slug: z.string(),
        title: z.string(),
        status: productStatusSchema,
        creatorId: z.string(),
        categoryId: z.uuid().nullable(),
        digitalPriceCents: z.int().nullable(),
        printBasePriceCents: z.int().nullable(),
        license: licenseSchema.nullable(),
        sizeXMm: z.int().nullable(),
        sizeYMm: z.int().nullable(),
        sizeZMm: z.int().nullable(),
        printWeightG: z.int().nullable(),
        featuredAt: timestampSchema.nullable(),
        publishedAt: timestampSchema.nullable(),
        createdAt: timestampSchema,
        updatedAt: timestampSchema,
    })
    .meta({ id: 'AdminProductSummary' });
export type AdminProductSummary = z.infer<typeof adminProductSummarySchema>;

export const adminProductImageSchema = z
    .object({
        id: z.uuid(),
        /** Public URL, or `null` while file storage isn't configured. */
        url: z.url().nullable(),
        alt: z.string(),
        width: z.int(),
        height: z.int(),
        sizeBytes: z.int(),
        position: z.int(),
    })
    .meta({ id: 'AdminProductImage' });
export type AdminProductImage = z.infer<typeof adminProductImageSchema>;

export const adminProductFileSchema = z
    .object({
        id: z.uuid(),
        kind: productFileKindSchema,
        /** Public URL of a preview. Always `null` for downloads, which are private (and while storage isn't configured). */
        url: z.url().nullable(),
        format: productFileFormatSchema,
        filename: z.string(),
        sizeBytes: z.int(),
        position: z.int(),
    })
    .meta({ id: 'AdminProductFile' });
export type AdminProductFile = z.infer<typeof adminProductFileSchema>;

export const adminProductSchema = adminProductSummarySchema
    .extend({
        description: z.string(),
        /** Ordered by position; the first is the cover. */
        images: z.array(adminProductImageSchema),
        files: z.array(adminProductFileSchema),
    })
    .meta({ id: 'AdminProduct' });
export type AdminProduct = z.infer<typeof adminProductSchema>;

export const adminProductListSchema = z
    .object({
        products: z.array(adminProductSummarySchema),
        page: z.int(),
        pageSize: z.int(),
        total: z.int(),
    })
    .meta({ id: 'AdminProductList' });
export type AdminProductList = z.infer<typeof adminProductListSchema>;

// ---------------------------------------------------------------------------
// Publishing rules (shared so the admin UI can show the same checklist the API enforces)

export interface PublishCheckInput extends ProductOffers {
    categoryId: string | null;
    license: License | null;
    imageCount: number;
    downloadFileCount: number;
}

/** Paid files must use one of the shop's own licences. Applies to drafts too. */
export function licenseIssue(product: Pick<PublishCheckInput, 'digitalPriceCents' | 'license'>): ApiErrorIssue | null {
    if (isPaidFile(product) && product.license !== null && !isOwnLicense(product.license)) {
        return {
            path: 'license',
            message: 'A paid file must use the Standard Digital File or Commercial Use licence.',
        };
    }
    return null;
}

/** Everything that must change before the product can be published. Empty when it's ready. */
export function publishProblems(product: PublishCheckInput): ApiErrorIssue[] {
    const issues: ApiErrorIssue[] = [];
    if (product.categoryId === null) {
        issues.push({ path: 'categoryId', message: 'Choose a category.' });
    }
    if (!offersFile(product) && !offersPrint(product)) {
        issues.push({ path: 'digitalPriceCents', message: 'Offer the file, a print, or both.' });
    }
    if (offersFile(product) && product.license === null) {
        issues.push({ path: 'license', message: 'Choose a licence for the file.' });
    }
    const license = licenseIssue(product);
    if (license) {
        issues.push(license);
    }
    if (product.imageCount === 0) {
        issues.push({ path: 'images', message: 'Add at least one image.' });
    }
    if (offersFile(product) && product.downloadFileCount === 0) {
        issues.push({ path: 'files', message: 'Upload the file to download, or stop offering it.' });
    }
    return issues;
}
