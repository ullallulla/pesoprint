import { z } from 'zod';

import { licenseSchema } from './licenses.ts';
import { productFileFormatSchema } from './products.ts';

/**
 * The public catalogue: what anyone can see without signing in. Only published products appear here.
 * Prices are euro cents including VAT; see `pricing.ts` for what `null` and `0` mean.
 */

// ---------------------------------------------------------------------------
// Requests

export const CATALOG_SORTS = ['relevance', 'newest', 'downloads', 'price-asc', 'price-desc', 'title'] as const;
export const catalogSortSchema = z.enum(CATALOG_SORTS);
export type CatalogSort = z.infer<typeof catalogSortSchema>;

/** `free`: free download. `paid`: a paid file. `print`: can be ordered as a print. */
export const catalogOfferSchema = z.enum(['free', 'paid', 'print']);
export type CatalogOffer = z.infer<typeof catalogOfferSchema>;

export const catalogProductListQuerySchema = z.object({
    /** A category slug. A top-level category also includes its subcategories' products. */
    category: z.string().max(100).optional(),
    /** Search words. Each word matches the start of words in the title and description ("drag" finds "dragon"). */
    q: z.string().trim().min(1).max(100).optional(),
    offer: catalogOfferSchema.optional(),
    /** Defaults to `relevance` when searching, otherwise `newest`. */
    sort: catalogSortSchema.optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(48).default(24),
});
export type CatalogProductListQuery = z.infer<typeof catalogProductListQuerySchema>;

// ---------------------------------------------------------------------------
// Responses

export const catalogImageSchema = z
    .object({
        url: z.url(),
        alt: z.string(),
        width: z.int(),
        height: z.int(),
    })
    .meta({ id: 'CatalogImage' });
export type CatalogImage = z.infer<typeof catalogImageSchema>;

const categoryRefSchema = z.object({ slug: z.string(), name: z.string() });

/** What a product card shows: enough for a grid, nothing more. */
export const catalogProductCardSchema = z
    .object({
        slug: z.string(),
        title: z.string(),
        category: categoryRefSchema.nullable(),
        /** The first gallery image. `null` while file storage isn't configured. */
        cover: catalogImageSchema.nullable(),
        /** `null` = no file, `0` = free download, `> 0` = paid file. */
        digitalPriceCents: z.int().nullable(),
        /** Print price before the material surcharge (shown as "from"). `null` = not offered as a print. */
        printBasePriceCents: z.int().nullable(),
        /** How many times visitors downloaded the model's files. */
        downloadCount: z.int().nonnegative(),
        publishedAt: z.iso.datetime(),
    })
    .meta({ id: 'CatalogProductCard' });
export type CatalogProductCard = z.infer<typeof catalogProductCardSchema>;

export const catalogProductSchema = catalogProductCardSchema
    .extend({
        /** Markdown. Render without raw HTML. */
        description: z.string(),
        category: categoryRefSchema.extend({ parent: categoryRefSchema.nullable() }).nullable(),
        license: licenseSchema.nullable(),
        /** Printed size in mm. */
        size: z.object({ x: z.int(), y: z.int(), z: z.int() }).nullable(),
        printWeightG: z.int().nullable(),
        /** The gallery, cover first. */
        images: z.array(catalogImageSchema),
        /** The decimated GLB for the 3D viewer. */
        preview: z.object({ url: z.url() }).nullable(),
        /** What the download contains. The files themselves are only served through the download endpoint. */
        files: z.array(
            z.object({ id: z.uuid(), format: productFileFormatSchema, filename: z.string(), sizeBytes: z.int() }),
        ),
        updatedAt: z.iso.datetime(),
    })
    .meta({ id: 'CatalogProduct' });
export type CatalogProduct = z.infer<typeof catalogProductSchema>;

export const catalogProductListSchema = z
    .object({
        products: z.array(catalogProductCardSchema),
        page: z.int(),
        pageSize: z.int(),
        total: z.int(),
        sort: catalogSortSchema,
    })
    .meta({ id: 'CatalogProductList' });
export type CatalogProductList = z.infer<typeof catalogProductListSchema>;

export const catalogHomeSchema = z
    .object({
        /** Most recently featured first. */
        featured: z.array(catalogProductCardSchema),
        newest: z.array(catalogProductCardSchema),
    })
    .meta({ id: 'CatalogHome' });
export type CatalogHome = z.infer<typeof catalogHomeSchema>;

const catalogCategoryFields = {
    slug: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    /** Published products in this category, including its subcategories. */
    productCount: z.int(),
};

export const catalogCategorySchema = z
    .object({
        ...catalogCategoryFields,
        children: z.array(z.object(catalogCategoryFields)),
    })
    .meta({ id: 'CatalogCategory' });
export type CatalogCategory = z.infer<typeof catalogCategorySchema>;

export const catalogCategoryTreeSchema = z
    .object({ categories: z.array(catalogCategorySchema) })
    .meta({ id: 'CatalogCategoryTree' });
export type CatalogCategoryTree = z.infer<typeof catalogCategoryTreeSchema>;

export const catalogSitemapSchema = z
    .object({
        products: z.array(z.object({ slug: z.string(), updatedAt: z.iso.datetime() })),
        categories: z.array(z.object({ slug: z.string() })),
    })
    .meta({ id: 'CatalogSitemap' });
export type CatalogSitemap = z.infer<typeof catalogSitemapSchema>;
