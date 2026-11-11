import {
    licenseIssue,
    publishProblems,
    type AdminProduct,
    type AdminProductList,
    type AdminProductListQuery,
    type AdminProductSummary,
    type CreateProduct,
    type UpdateProduct,
} from '@app/shared';
import { and, asc, count, desc, eq, ilike, or, type SQL } from 'drizzle-orm';

import type { Database } from '../db/client.ts';
import { isPgError, PgErrorCode } from '../db/errors.ts';
import { productFiles, productImages, products, type Product } from '../db/schema.ts';
import { conflict, invalidField, notFound } from '../lib/errors.ts';
import { definedFields } from '../lib/patch.ts';

export interface ProductsService {
    /** Products of every status, most recently updated first. */
    list(query: AdminProductListQuery): Promise<AdminProductList>;
    get(id: string): Promise<AdminProduct>;
    /** Creates a draft owned by `creatorId`. */
    create(creatorId: string, input: CreateProduct): Promise<AdminProduct>;
    update(id: string, input: UpdateProduct): Promise<AdminProduct>;
    /** Makes the product public. Fails with a list of problems if it isn't ready. Idempotent. */
    publish(id: string): Promise<AdminProduct>;
    /** Hides a published product from the catalogue. Buyers keep access to what they bought. */
    archive(id: string): Promise<AdminProduct>;
    /** `true` puts the product first in the featured section (again, if it already was). */
    setFeatured(id: string, featured: boolean): Promise<AdminProduct>;
    /** Only drafts that were never published can be deleted; published products are archived instead. */
    remove(id: string): Promise<void>;
}

/** A database handle or an open transaction. */
type Executor = Pick<Database, 'select'>;

const iso = (date: Date | null) => date?.toISOString() ?? null;

function toSummary(row: Product): AdminProductSummary {
    return {
        id: row.id,
        slug: row.slug,
        title: row.title,
        status: row.status,
        creatorId: row.creatorId,
        categoryId: row.categoryId,
        digitalPriceCents: row.digitalPriceCents,
        printBasePriceCents: row.printBasePriceCents,
        license: row.license,
        sizeXMm: row.sizeXMm,
        sizeYMm: row.sizeYMm,
        sizeZMm: row.sizeZMm,
        printWeightG: row.printWeightG,
        featuredAt: iso(row.featuredAt),
        publishedAt: iso(row.publishedAt),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

async function toDetail(tx: Executor, row: Product): Promise<AdminProduct> {
    const images = await tx
        .select({
            id: productImages.id,
            alt: productImages.alt,
            width: productImages.width,
            height: productImages.height,
            sizeBytes: productImages.sizeBytes,
            position: productImages.position,
        })
        .from(productImages)
        .where(eq(productImages.productId, row.id))
        .orderBy(asc(productImages.position), asc(productImages.id));
    const files = await tx
        .select({
            id: productFiles.id,
            kind: productFiles.kind,
            format: productFiles.format,
            filename: productFiles.filename,
            sizeBytes: productFiles.sizeBytes,
            position: productFiles.position,
        })
        .from(productFiles)
        .where(eq(productFiles.productId, row.id))
        .orderBy(asc(productFiles.position), asc(productFiles.id));
    return { ...toSummary(row), description: row.description, images, files };
}

/** Reads the product and locks it until the transaction ends, so checks and writes can't interleave. */
async function lockProduct(tx: Executor, id: string): Promise<Product> {
    const [row] = await tx.select().from(products).where(eq(products.id, id)).for('update');
    if (!row) {
        throw notFound('Product not found.');
    }
    return row;
}

async function contentCounts(tx: Executor, productId: string) {
    const [images] = await tx
        .select({ value: count() })
        .from(productImages)
        .where(eq(productImages.productId, productId));
    const [downloads] = await tx
        .select({ value: count() })
        .from(productFiles)
        .where(and(eq(productFiles.productId, productId), eq(productFiles.kind, 'download')));
    return { imageCount: images?.value ?? 0, downloadFileCount: downloads?.value ?? 0 };
}

function assertLicenseAllowed(product: Pick<Product, 'digitalPriceCents' | 'license'>): void {
    const issue = licenseIssue(product);
    if (issue) {
        throw invalidField(issue.path, issue.message);
    }
}

/** Turns constraint errors from an insert or update into API errors; rethrows anything else. */
function rethrowWriteError(error: unknown, slug: string | undefined): never {
    if (isPgError(error, PgErrorCode.uniqueViolation, 'products_slug_unique')) {
        throw conflict(`A product with the slug "${slug}" already exists.`, [
            { path: 'slug', message: 'This slug is already taken.' },
        ]);
    }
    if (isPgError(error, PgErrorCode.foreignKeyViolation, 'products_category_id_categories_id_fk')) {
        throw invalidField('categoryId', 'The category does not exist.');
    }
    if (isPgError(error, PgErrorCode.foreignKeyViolation, 'products_creator_id_users_id_fk')) {
        // The Clerk webhook hasn't created the caller's `users` row yet.
        throw conflict('Your account has not been synced from Clerk yet. Try again in a moment.');
    }
    throw error;
}

/** Escapes `%`, `_` and `\` so user input matches literally inside an ILIKE pattern. */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&');

export function createProductsService(db: Database): ProductsService {
    return {
        async list({ status, categoryId, q, page, pageSize }) {
            const conditions: SQL[] = [];
            if (status) conditions.push(eq(products.status, status));
            if (categoryId) conditions.push(eq(products.categoryId, categoryId));
            if (q) {
                const pattern = `%${escapeLike(q)}%`;
                conditions.push(or(ilike(products.title, pattern), ilike(products.slug, pattern))!);
            }
            const where = and(...conditions);

            const rows = await db
                .select()
                .from(products)
                .where(where)
                .orderBy(desc(products.updatedAt), desc(products.id))
                .limit(pageSize)
                .offset((page - 1) * pageSize);
            const [total] = await db.select({ value: count() }).from(products).where(where);

            return { products: rows.map(toSummary), page, pageSize, total: total?.value ?? 0 };
        },

        async get(id) {
            const [row] = await db.select().from(products).where(eq(products.id, id));
            if (!row) {
                throw notFound('Product not found.');
            }
            return toDetail(db, row);
        },

        async create(creatorId, input) {
            assertLicenseAllowed({
                digitalPriceCents: input.digitalPriceCents ?? null,
                license: input.license ?? null,
            });
            return db.transaction(async (tx) => {
                try {
                    const [row] = await tx
                        .insert(products)
                        .values({ ...input, creatorId })
                        .returning();
                    return await toDetail(tx, row!);
                } catch (error) {
                    rethrowWriteError(error, input.slug);
                }
            });
        },

        async update(id, input) {
            return db.transaction(async (tx) => {
                const current = await lockProduct(tx, id);
                const changes = definedFields(input);

                // Links, search results and shares point at the slug, so it's fixed once the product has been public.
                if (changes.slug !== undefined && changes.slug !== current.slug && current.publishedAt !== null) {
                    throw conflict('The slug cannot change after the product has been published.', [
                        { path: 'slug', message: 'Links to the old address would break.' },
                    ]);
                }

                const next = { ...current, ...changes };
                assertLicenseAllowed(next);
                if (current.status === 'published') {
                    const problems = publishProblems({ ...next, ...(await contentCounts(tx, id)) });
                    if (problems.length > 0) {
                        throw conflict('A published product must stay ready to publish.', problems);
                    }
                }

                if (Object.keys(changes).length === 0) {
                    return toDetail(tx, current);
                }
                try {
                    const [row] = await tx.update(products).set(changes).where(eq(products.id, id)).returning();
                    return await toDetail(tx, row!);
                } catch (error) {
                    rethrowWriteError(error, changes.slug);
                }
            });
        },

        async publish(id) {
            return db.transaction(async (tx) => {
                const current = await lockProduct(tx, id);
                if (current.status === 'published') {
                    return toDetail(tx, current);
                }

                const problems = publishProblems({ ...current, ...(await contentCounts(tx, id)) });
                if (problems.length > 0) {
                    throw conflict("The product isn't ready to publish.", problems);
                }

                const [row] = await tx
                    .update(products)
                    // Republishing an archived product keeps its first publication date.
                    .set({ status: 'published', publishedAt: current.publishedAt ?? new Date() })
                    .where(eq(products.id, id))
                    .returning();
                return toDetail(tx, row!);
            });
        },

        async archive(id) {
            return db.transaction(async (tx) => {
                const current = await lockProduct(tx, id);
                if (current.status === 'archived') {
                    return toDetail(tx, current);
                }
                if (current.status !== 'published') {
                    throw conflict('Only published products can be archived. Delete the draft instead.');
                }

                const [row] = await tx
                    .update(products)
                    .set({ status: 'archived', featuredAt: null })
                    .where(eq(products.id, id))
                    .returning();
                return toDetail(tx, row!);
            });
        },

        async setFeatured(id, featured) {
            return db.transaction(async (tx) => {
                const current = await lockProduct(tx, id);
                if (featured && current.status === 'archived') {
                    throw conflict('Archived products cannot be featured. Publish it again first.');
                }

                const [row] = await tx
                    .update(products)
                    .set({ featuredAt: featured ? new Date() : null })
                    .where(eq(products.id, id))
                    .returning();
                return toDetail(tx, row!);
            });
        },

        async remove(id) {
            await db.transaction(async (tx) => {
                const current = await lockProduct(tx, id);
                if (current.publishedAt !== null) {
                    throw conflict('Products that have been published cannot be deleted. Archive it instead.');
                }
                // Images and files rows cascade. Their storage objects are deleted here once uploads exist (step 5).
                await tx.delete(products).where(eq(products.id, id));
            });
        },
    };
}
