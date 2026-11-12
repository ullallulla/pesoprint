import type {
    CatalogCategory,
    CatalogHome,
    CatalogImage,
    CatalogProduct,
    CatalogProductCard,
    CatalogProductList,
    CatalogProductListQuery,
    CatalogSitemap,
    CatalogSort,
} from '@app/shared';
import { and, asc, count, desc, eq, gt, inArray, isNotNull, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type { Database } from '../db/client.ts';
import { categories, productFiles, productImages, products, type ProductImage } from '../db/schema.ts';
import { notFound } from '../lib/errors.ts';
import type { Storage } from '../lib/storage.ts';

/** The public, read-only view of the catalogue. Everything here is limited to published products. */
export interface CatalogService {
    home(): Promise<CatalogHome>;
    categories(): Promise<CatalogCategory[]>;
    list(query: CatalogProductListQuery): Promise<CatalogProductList>;
    product(slug: string): Promise<CatalogProduct>;
    sitemap(): Promise<CatalogSitemap>;
}

/** How many products the home page sections show. */
export const HOME_SECTION_SIZE = 8;

/**
 * Turns search words into a prefix query: `"drag stand"` → `drag:* & stand:*`.
 * Only letters and digits survive, so user input can't inject tsquery syntax. `null` if nothing is left.
 */
export function prefixTsQuery(q: string): string | null {
    const words =
        q
            .toLowerCase()
            .match(/[\p{L}\p{N}]+/gu)
            ?.slice(0, 8) ?? [];
    return words.length > 0 ? words.map((word) => `${word}:*`).join(' & ') : null;
}

const isPublished = eq(products.status, 'published');
/** The lowest price the product is offered at (Postgres LEAST ignores NULLs). */
const lowestPrice = sql`LEAST(${products.digitalPriceCents}, ${products.printBasePriceCents})`;

const cardColumns = {
    id: products.id,
    slug: products.slug,
    title: products.title,
    digitalPriceCents: products.digitalPriceCents,
    printBasePriceCents: products.printBasePriceCents,
    publishedAt: products.publishedAt,
    categorySlug: categories.slug,
    categoryName: categories.name,
};

type CardRow = {
    id: string;
    slug: string;
    title: string;
    digitalPriceCents: number | null;
    printBasePriceCents: number | null;
    publishedAt: Date | null;
    categorySlug: string | null;
    categoryName: string | null;
};

export function createCatalogService(db: Database, storage: Storage | null): CatalogService {
    const image = (row: ProductImage): CatalogImage | null =>
        storage ? { url: storage.publicUrl(row.storageKey), alt: row.alt, width: row.width, height: row.height } : null;

    /** Cover image (lowest position) for each product, in one query. */
    async function coversFor(productIds: string[]): Promise<Map<string, ProductImage>> {
        if (productIds.length === 0) return new Map();
        const rows = await db
            .selectDistinctOn([productImages.productId])
            .from(productImages)
            .where(inArray(productImages.productId, productIds))
            .orderBy(productImages.productId, asc(productImages.position), asc(productImages.id));
        return new Map(rows.map((row) => [row.productId, row]));
    }

    async function toCards(rows: CardRow[]): Promise<CatalogProductCard[]> {
        const covers = await coversFor(rows.map((row) => row.id));
        return rows.map((row) => {
            const cover = covers.get(row.id);
            return {
                slug: row.slug,
                title: row.title,
                category: row.categorySlug ? { slug: row.categorySlug, name: row.categoryName! } : null,
                cover: cover ? image(cover) : null,
                digitalPriceCents: row.digitalPriceCents,
                printBasePriceCents: row.printBasePriceCents,
                // Published products always have publishedAt (database CHECK).
                publishedAt: row.publishedAt!.toISOString(),
            };
        });
    }

    function selectCards(where: SQL | undefined, orderBy: SQL[], limit: number, offset = 0) {
        return db
            .select(cardColumns)
            .from(products)
            .leftJoin(categories, eq(categories.id, products.categoryId))
            .where(where)
            .orderBy(...orderBy)
            .limit(limit)
            .offset(offset);
    }

    async function categoryTree(): Promise<CatalogCategory[]> {
        const rows = await db.select().from(categories).orderBy(asc(categories.position), asc(categories.name));
        const counts = await db
            .select({ categoryId: products.categoryId, value: count() })
            .from(products)
            .where(isPublished)
            .groupBy(products.categoryId);
        const countOf = new Map(counts.map((row) => [row.categoryId, row.value]));

        return rows
            .filter((row) => row.parentId === null)
            .map((parent) => {
                const children = rows
                    .filter((row) => row.parentId === parent.id)
                    .map((child) => ({
                        slug: child.slug,
                        name: child.name,
                        description: child.description,
                        productCount: countOf.get(child.id) ?? 0,
                    }));
                return {
                    slug: parent.slug,
                    name: parent.name,
                    description: parent.description,
                    productCount:
                        (countOf.get(parent.id) ?? 0) + children.reduce((sum, child) => sum + child.productCount, 0),
                    children,
                };
            });
    }

    return {
        async home() {
            const [featured, newest] = await Promise.all([
                selectCards(
                    and(isPublished, isNotNull(products.featuredAt)),
                    [desc(products.featuredAt)],
                    HOME_SECTION_SIZE,
                ),
                selectCards(isPublished, [desc(products.publishedAt), desc(products.id)], HOME_SECTION_SIZE),
            ]);
            return { featured: await toCards(featured), newest: await toCards(newest) };
        },

        categories: categoryTree,

        async list({ category, q, offer, sort, page, pageSize }) {
            const conditions: SQL[] = [isPublished];

            if (category) {
                const [match] = await db
                    .select({ id: categories.id })
                    .from(categories)
                    .where(eq(categories.slug, category));
                if (!match) throw notFound('Category not found.');
                const children = await db
                    .select({ id: categories.id })
                    .from(categories)
                    .where(eq(categories.parentId, match.id));
                conditions.push(inArray(products.categoryId, [match.id, ...children.map((c) => c.id)]));
            }

            const tsQuery = q ? prefixTsQuery(q) : null;
            const tsQuerySql = tsQuery ? sql`to_tsquery('english', ${tsQuery})` : null;
            if (q) {
                // Words without letters or digits (e.g. only punctuation) match nothing.
                conditions.push(tsQuerySql ? sql`${products.searchVector} @@ ${tsQuerySql}` : sql`false`);
            }

            if (offer === 'free') conditions.push(eq(products.digitalPriceCents, 0));
            if (offer === 'paid') conditions.push(gt(products.digitalPriceCents, 0));
            if (offer === 'print') conditions.push(isNotNull(products.printBasePriceCents));

            let effectiveSort: CatalogSort = sort ?? (tsQuerySql ? 'relevance' : 'newest');
            if (effectiveSort === 'relevance' && !tsQuerySql) effectiveSort = 'newest';

            const newestFirst = [desc(products.publishedAt), desc(products.id)];
            const orderBy: Record<CatalogSort, SQL[]> = {
                relevance: [sql`ts_rank(${products.searchVector}, ${tsQuerySql}) DESC`, ...newestFirst],
                newest: newestFirst,
                'price-asc': [sql`${lowestPrice} ASC NULLS LAST`, ...newestFirst],
                'price-desc': [sql`${lowestPrice} DESC NULLS LAST`, ...newestFirst],
                title: [asc(sql`lower(${products.title})`), asc(products.id)],
            };

            const where = and(...conditions);
            const rows = await selectCards(where, orderBy[effectiveSort], pageSize, (page - 1) * pageSize);
            const [total] = await db.select({ value: count() }).from(products).where(where);

            return {
                products: await toCards(rows),
                page,
                pageSize,
                total: total?.value ?? 0,
                sort: effectiveSort,
            };
        },

        async product(slug) {
            const parent = alias(categories, 'parent');
            const [row] = await db
                .select({
                    product: products,
                    category: { slug: categories.slug, name: categories.name },
                    parent: { slug: parent.slug, name: parent.name },
                })
                .from(products)
                .leftJoin(categories, eq(categories.id, products.categoryId))
                .leftJoin(parent, eq(parent.id, categories.parentId))
                .where(and(isPublished, eq(products.slug, slug)));
            if (!row) throw notFound('Product not found.');
            const { product } = row;

            const images = await db
                .select()
                .from(productImages)
                .where(eq(productImages.productId, product.id))
                .orderBy(asc(productImages.position), asc(productImages.id));
            const files = await db
                .select()
                .from(productFiles)
                .where(eq(productFiles.productId, product.id))
                .orderBy(asc(productFiles.position), asc(productFiles.id));

            const gallery = images.map(image).filter((entry): entry is CatalogImage => entry !== null);
            const preview = files.find((file) => file.kind === 'preview');
            const { sizeXMm: x, sizeYMm: y, sizeZMm: z } = product;

            return {
                slug: product.slug,
                title: product.title,
                description: product.description,
                category: row.category
                    ? { slug: row.category.slug, name: row.category.name, parent: row.parent ?? null }
                    : null,
                cover: gallery[0] ?? null,
                images: gallery,
                preview: preview && storage ? { url: storage.publicUrl(preview.storageKey) } : null,
                files: files
                    .filter((file) => file.kind === 'download')
                    .map((file) => ({
                        id: file.id,
                        format: file.format,
                        filename: file.filename,
                        sizeBytes: file.sizeBytes,
                    })),
                downloadCount: product.downloadCount,
                digitalPriceCents: product.digitalPriceCents,
                printBasePriceCents: product.printBasePriceCents,
                license: product.license,
                size: x !== null && y !== null && z !== null ? { x, y, z } : null,
                printWeightG: product.printWeightG,
                publishedAt: product.publishedAt!.toISOString(),
                updatedAt: product.updatedAt.toISOString(),
            };
        },

        async sitemap() {
            const rows = await db
                .select({ slug: products.slug, updatedAt: products.updatedAt })
                .from(products)
                .where(isPublished)
                .orderBy(asc(products.slug));
            // Only categories with something to show: empty pages don't belong in a sitemap.
            const tree = await categoryTree();
            const withProducts = tree
                .flatMap((parent) => [parent, ...parent.children])
                .filter((c) => c.productCount > 0);
            return {
                products: rows.map((row) => ({ slug: row.slug, updatedAt: row.updatedAt.toISOString() })),
                categories: withProducts.map((c) => ({ slug: c.slug })),
            };
        },
    };
}
