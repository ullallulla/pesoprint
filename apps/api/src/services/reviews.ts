import {
    isFreeDownload,
    reviewAuthorName,
    type MyReview,
    type ProductReviews,
    type ProductReviewsQuery,
    type Review as ReviewView,
    type ReviewInput,
} from '@app/shared';
import { and, count, desc, eq, exists, isNull, or, sql } from 'drizzle-orm';

import type { Database } from '../db/client.ts';
import {
    downloadEvents,
    entitlements,
    orderItems,
    orders,
    products,
    reviews,
    users,
    type Product,
    type Review,
} from '../db/schema.ts';
import type { AuthContext } from '../lib/auth.ts';
import { AppError, notFound } from '../lib/errors.ts';

/** Reviews on a model's page, and the signed-in visitor's own review. Hiding reviews is in `admin-reviews`. */
export interface ReviewsService {
    /** One page of a published model's visible reviews, newest first. */
    list(slug: string, query: ProductReviewsQuery): Promise<ProductReviews>;
    /** The caller's review of a published model, and whether they may write one. */
    mine(caller: AuthContext, productId: string): Promise<MyReview>;
    /** Writes the caller's review, or replaces theirs. Refuses anyone who may not review the model (403). */
    save(caller: AuthContext, productId: string, input: ReviewInput): Promise<MyReview>;
    /** Deletes the caller's review of the model, if they wrote one. */
    remove(caller: AuthContext, productId: string): Promise<void>;
}

export interface ReviewsOptions {
    now?: () => Date;
}

type ReviewedProduct = Pick<Product, 'id' | 'creatorId' | 'digitalPriceCents'>;

/**
 * Who may review a model: someone who has it, never its creator.
 * - they bought its file (an entitlement), or
 * - a print of it was delivered to them, or
 * - it's a free download and they downloaded it while signed in.
 */
export async function canReview(db: Database, userId: string, product: ReviewedProduct): Promise<boolean> {
    if (product.creatorId === userId) return false;

    const owns = db
        .select({ one: sql`1` })
        .from(entitlements)
        .where(and(eq(entitlements.userId, userId), eq(entitlements.productId, product.id)));
    const receivedPrint = db
        .select({ one: sql`1` })
        .from(orderItems)
        .innerJoin(orders, eq(orders.id, orderItems.orderId))
        .where(
            and(
                eq(orders.userId, userId),
                eq(orders.status, 'delivered'),
                eq(orderItems.productId, product.id),
                eq(orderItems.type, 'print'),
            ),
        );
    const downloaded = db
        .select({ one: sql`1` })
        .from(downloadEvents)
        .where(and(eq(downloadEvents.userId, userId), eq(downloadEvents.productId, product.id)));

    const { rows } = await db.execute<{ eligible: boolean }>(
        sql`SELECT ${or(exists(owns), exists(receivedPrint), isFreeDownload(product) ? exists(downloaded) : undefined)} AS eligible`,
    );
    return rows[0]?.eligible === true;
}

/** A review as the public sees it. */
export function reviewView(review: Review, displayName: string | null): ReviewView {
    return {
        id: review.id,
        rating: review.rating,
        body: review.body,
        author: reviewAuthorName(displayName),
        createdAt: review.createdAt.toISOString(),
        editedAt: review.editedAt?.toISOString() ?? null,
    };
}

export const NOT_ELIGIBLE_MESSAGE =
    'Only people who bought this model, received a print of it or downloaded it can review it.';

export function createReviewsService(db: Database, { now = () => new Date() }: ReviewsOptions = {}): ReviewsService {
    /** A published model, or 404. */
    async function publishedProduct(productId: string): Promise<ReviewedProduct> {
        const [product] = await db
            .select({ id: products.id, creatorId: products.creatorId, digitalPriceCents: products.digitalPriceCents })
            .from(products)
            .where(and(eq(products.id, productId), eq(products.status, 'published')));
        if (!product) throw notFound('Model not found.');
        return product;
    }

    async function ownReview(userId: string, productId: string) {
        const [row] = await db
            .select({ review: reviews, displayName: users.displayName })
            .from(reviews)
            .innerJoin(users, eq(users.id, reviews.userId))
            .where(and(eq(reviews.userId, userId), eq(reviews.productId, productId)));
        return row ? { ...reviewView(row.review, row.displayName), hidden: row.review.hiddenAt !== null } : null;
    }

    return {
        async list(slug, { page, pageSize }) {
            const [product] = await db
                .select({ id: products.id })
                .from(products)
                .where(and(eq(products.slug, slug), eq(products.status, 'published')));
            if (!product) throw notFound('Product not found.');

            const where = and(eq(reviews.productId, product.id), isNull(reviews.hiddenAt));
            const rows = await db
                .select({ review: reviews, displayName: users.displayName })
                .from(reviews)
                .innerJoin(users, eq(users.id, reviews.userId))
                .where(where)
                .orderBy(desc(reviews.createdAt), desc(reviews.id))
                .limit(pageSize)
                .offset((page - 1) * pageSize);
            const [total] = await db.select({ value: count() }).from(reviews).where(where);

            return {
                reviews: rows.map((row) => reviewView(row.review, row.displayName)),
                page,
                pageSize,
                total: total?.value ?? 0,
            };
        },

        async mine(caller, productId) {
            const product = await publishedProduct(productId);
            const [eligible, review] = await Promise.all([
                canReview(db, caller.userId, product),
                ownReview(caller.userId, productId),
            ]);
            return { eligible, review };
        },

        async save(caller, productId, { rating, body }) {
            const product = await publishedProduct(productId);
            if (!(await canReview(db, caller.userId, product))) {
                throw new AppError(403, 'forbidden', NOT_ELIGIBLE_MESSAGE);
            }

            await db
                .insert(reviews)
                .values({ productId, userId: caller.userId, rating, body, createdAt: now() })
                .onConflictDoUpdate({
                    target: [reviews.productId, reviews.userId],
                    set: {
                        rating,
                        body,
                        // Sending the same review again isn't an edit. A hidden review stays hidden.
                        editedAt: sql`CASE
                            WHEN ${reviews.rating} IS DISTINCT FROM excluded.rating
                                OR ${reviews.body} IS DISTINCT FROM excluded.body
                            THEN ${now().toISOString()}::timestamptz
                            ELSE ${reviews.editedAt}
                        END`,
                    },
                });
            return { eligible: true, review: await ownReview(caller.userId, productId) };
        },

        async remove(caller, productId) {
            await db.delete(reviews).where(and(eq(reviews.userId, caller.userId), eq(reviews.productId, productId)));
        },
    };
}
