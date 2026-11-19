import type { AdminReview, AdminReviewList, AdminReviewListQuery, SetReviewHidden } from '@app/shared';
import { and, count, desc, eq, ilike, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';

import type { Database } from '../db/client.ts';
import { products, reviews, users } from '../db/schema.ts';
import { notFound } from '../lib/errors.ts';
import { escapeLike } from '../lib/like.ts';
import { reviewView } from './reviews.ts';

/** The shop's view of reviews: every one, with who wrote it, and hiding the ones that break the rules. */
export interface AdminReviewsService {
    /** One page of reviews, newest first. */
    list(query: AdminReviewListQuery): Promise<AdminReviewList>;
    /**
     * Hides a review from its model's page and rating, or shows it again. Hiding a hidden review keeps the time
     * it was first hidden.
     */
    setHidden(reviewId: string, change: SetReviewHidden): Promise<AdminReview>;
}

export interface AdminReviewsOptions {
    now?: () => Date;
}

const columns = {
    review: reviews,
    product: { id: products.id, slug: products.slug, title: products.title, status: products.status },
    user: { id: users.id, email: users.email, displayName: users.displayName },
};

export function createAdminReviewsService(
    db: Database,
    { now = () => new Date() }: AdminReviewsOptions = {},
): AdminReviewsService {
    function select(where: SQL | undefined) {
        return db
            .select(columns)
            .from(reviews)
            .innerJoin(products, eq(products.id, reviews.productId))
            .innerJoin(users, eq(users.id, reviews.userId))
            .where(where);
    }

    function toAdmin(row: Awaited<ReturnType<typeof select>>[number]): AdminReview {
        return {
            ...reviewView(row.review, row.user.displayName),
            hiddenAt: row.review.hiddenAt?.toISOString() ?? null,
            product: {
                id: row.product.id,
                slug: row.product.slug,
                title: row.product.title,
                listed: row.product.status === 'published',
            },
            user: row.user,
        };
    }

    async function get(reviewId: string): Promise<AdminReview> {
        const [row] = await select(eq(reviews.id, reviewId));
        if (!row) throw notFound('Review not found.');
        return toAdmin(row);
    }

    return {
        async list({ visibility, q, page, pageSize }) {
            const conditions: SQL[] = [];
            if (visibility === 'visible') conditions.push(isNull(reviews.hiddenAt));
            if (visibility === 'hidden') conditions.push(isNotNull(reviews.hiddenAt));
            if (q) {
                const pattern = `%${escapeLike(q)}%`;
                conditions.push(
                    or(
                        ilike(reviews.body, pattern),
                        ilike(products.title, pattern),
                        ilike(users.displayName, pattern),
                        ilike(users.email, pattern),
                    )!,
                );
            }
            const where = and(...conditions);

            const rows = await select(where)
                .orderBy(desc(reviews.createdAt), desc(reviews.id))
                .limit(pageSize)
                .offset((page - 1) * pageSize);
            const [total] = await db
                .select({ value: count() })
                .from(reviews)
                .innerJoin(products, eq(products.id, reviews.productId))
                .innerJoin(users, eq(users.id, reviews.userId))
                .where(where);

            return { reviews: rows.map(toAdmin), page, pageSize, total: total?.value ?? 0 };
        },

        async setHidden(reviewId, { hidden }) {
            const [updated] = await db
                .update(reviews)
                .set({
                    hiddenAt: hidden ? sql`COALESCE(${reviews.hiddenAt}, ${now().toISOString()}::timestamptz)` : null,
                })
                .where(eq(reviews.id, reviewId))
                .returning({ id: reviews.id });
            if (!updated) throw notFound('Review not found.');
            return get(reviewId);
        },
    };
}
