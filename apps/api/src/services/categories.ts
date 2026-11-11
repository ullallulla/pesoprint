import type { AdminCategory, Category, CreateCategory, UpdateCategory } from '@app/shared';
import { asc, count, eq, sql } from 'drizzle-orm';

import type { Database } from '../db/client.ts';
import { isPgError, PgErrorCode } from '../db/errors.ts';
import { categories, products } from '../db/schema.ts';
import { conflict, invalidField, notFound } from '../lib/errors.ts';
import { definedFields } from '../lib/patch.ts';

export interface CategoriesService {
    /** Every category, ordered by position then name. Clients build the two-level tree from `parentId`. */
    list(): Promise<AdminCategory[]>;
    create(input: CreateCategory): Promise<Category>;
    update(id: string, input: UpdateCategory): Promise<Category>;
    /** Only empty categories can be deleted: no subcategories and no products. */
    remove(id: string): Promise<void>;
}

/** A database handle or an open transaction. */
type Executor = Pick<Database, 'select'>;

const columns = {
    id: categories.id,
    slug: categories.slug,
    name: categories.name,
    description: categories.description,
    parentId: categories.parentId,
    position: categories.position,
};

/**
 * Categories nest at most two levels: a parent must be top-level, and a category that has
 * subcategories can't become a subcategory itself. That also rules out cycles (A → B → A).
 */
async function assertCanNest(tx: Executor, categoryId: string | null, parentId: string): Promise<void> {
    if (parentId === categoryId) {
        throw invalidField('parentId', 'A category cannot be its own parent.');
    }

    // FOR SHARE: the parent can't be moved under another category until this transaction ends.
    const [parent] = await tx
        .select({ parentId: categories.parentId })
        .from(categories)
        .where(eq(categories.id, parentId))
        .for('share');
    if (!parent) {
        throw invalidField('parentId', 'The parent category does not exist.');
    }
    if (parent.parentId !== null) {
        throw invalidField('parentId', 'The parent is already a subcategory. Categories nest at most two levels.');
    }

    if (categoryId && (await countChildren(tx, categoryId)) > 0) {
        throw invalidField(
            'parentId',
            'This category has subcategories, so it cannot be moved under another category.',
        );
    }
}

async function countChildren(tx: Executor, id: string): Promise<number> {
    const [row] = await tx.select({ value: count() }).from(categories).where(eq(categories.parentId, id));
    return row?.value ?? 0;
}

/** Turns a duplicate-slug error from Postgres into a 409; rethrows anything else. */
function rethrowSlugConflict(error: unknown, slug: string | undefined): never {
    if (isPgError(error, PgErrorCode.uniqueViolation, 'categories_slug_unique')) {
        throw conflict(`A category with the slug "${slug}" already exists.`);
    }
    throw error;
}

export function createCategoriesService(db: Database): CategoriesService {
    return {
        async list() {
            return db
                .select({ ...columns, productCount: sql<number>`count(${products.id})::int` })
                .from(categories)
                .leftJoin(products, eq(products.categoryId, categories.id))
                .groupBy(categories.id)
                .orderBy(asc(categories.position), asc(categories.name));
        },

        async create(input) {
            return db.transaction(async (tx) => {
                if (input.parentId) {
                    await assertCanNest(tx, null, input.parentId);
                }
                try {
                    const [created] = await tx.insert(categories).values(input).returning(columns);
                    return created!;
                } catch (error) {
                    rethrowSlugConflict(error, input.slug);
                }
            });
        },

        async update(id, input) {
            return db.transaction(async (tx) => {
                // Lock the row so a concurrent move can't break the two-level rule between check and write.
                const [current] = await tx.select(columns).from(categories).where(eq(categories.id, id)).for('update');
                if (!current) {
                    throw notFound('Category not found.');
                }
                if (input.parentId) {
                    await assertCanNest(tx, id, input.parentId);
                }

                const changes = definedFields(input);
                if (Object.keys(changes).length === 0) {
                    return current;
                }

                try {
                    const [updated] = await tx
                        .update(categories)
                        .set(changes)
                        .where(eq(categories.id, id))
                        .returning(columns);
                    return updated!;
                } catch (error) {
                    rethrowSlugConflict(error, input.slug);
                }
            });
        },

        async remove(id) {
            await db.transaction(async (tx) => {
                const [current] = await tx
                    .select({ id: categories.id })
                    .from(categories)
                    .where(eq(categories.id, id))
                    .for('update');
                if (!current) {
                    throw notFound('Category not found.');
                }

                const children = await countChildren(tx, id);
                if (children > 0) {
                    throw conflict(
                        `This category has ${children} subcategor${children === 1 ? 'y' : 'ies'}. Move or delete them first.`,
                    );
                }

                const [productRow] = await tx
                    .select({ value: count() })
                    .from(products)
                    .where(eq(products.categoryId, id));
                const productCount = productRow?.value ?? 0;
                if (productCount > 0) {
                    throw conflict(
                        `This category has ${productCount} product${productCount === 1 ? '' : 's'}. Move them to another category first.`,
                    );
                }

                try {
                    await tx.delete(categories).where(eq(categories.id, id));
                } catch (error) {
                    // A product or subcategory was added after the checks above.
                    if (isPgError(error, PgErrorCode.restrictViolation)) {
                        throw conflict('This category is still in use. Reload and try again.');
                    }
                    throw error;
                }
            });
        },
    };
}
