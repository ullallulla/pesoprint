import { z } from 'zod';

/**
 * Reviews: a rating from 1 to 5 stars and a few words, one per person and model. Only people who bought the
 * model's file, received a print of it, or downloaded it while it was free (signed in) can write one; the API
 * decides that.
 */

export const REVIEW_BODY_MAX_LENGTH = 2000;

export const reviewRatingSchema = z
    .int('Choose a rating.')
    .min(1, 'Choose 1 to 5 stars.')
    .max(5, 'Choose 1 to 5 stars.');

/** What the author sends: a new review, or the new version of theirs. */
export const reviewInputSchema = z
    .object({
        rating: reviewRatingSchema,
        /** Plain text. Empty for a rating on its own. */
        body: z
            .string()
            .trim()
            .max(REVIEW_BODY_MAX_LENGTH, `Keep it under ${REVIEW_BODY_MAX_LENGTH.toLocaleString('en-IE')} characters.`)
            .default(''),
    })
    .meta({ id: 'ReviewInput' });
export type ReviewInput = z.infer<typeof reviewInputSchema>;

/** A model's average rating, from its visible reviews. `null` on a model without any. */
export const ratingSummarySchema = z
    .object({
        /** Rounded to one decimal: 4.3. */
        average: z.number().min(1).max(5),
        count: z.int().positive(),
    })
    .meta({ id: 'RatingSummary' });
export type RatingSummary = z.infer<typeof ratingSummarySchema>;

/** The summary from the stored totals: `null` when there are no ratings. */
export function ratingSummary(sum: number, count: number): RatingSummary | null {
    if (count <= 0) return null;
    return { average: Math.round((sum / count) * 10) / 10, count };
}

const timestampSchema = z.iso.datetime();

/** A review as anyone sees it. */
export const reviewSchema = z
    .object({
        id: z.uuid(),
        rating: reviewRatingSchema,
        body: z.string(),
        /** The author's first name and the initial of their last name ("Aino K."), never their full name. */
        author: z.string(),
        createdAt: timestampSchema,
        /** When the author last changed it. `null` if they never did. */
        editedAt: timestampSchema.nullable(),
    })
    .meta({ id: 'Review' });
export type Review = z.infer<typeof reviewSchema>;

export const productReviewsQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(10),
});
export type ProductReviewsQuery = z.infer<typeof productReviewsQuerySchema>;

/** One page of a model's visible reviews, newest first. */
export const productReviewsSchema = z
    .object({
        reviews: z.array(reviewSchema),
        page: z.int(),
        pageSize: z.int(),
        total: z.int(),
    })
    .meta({ id: 'ProductReviews' });
export type ProductReviews = z.infer<typeof productReviewsSchema>;

/** The caller's own review of a model, and whether they may write one. */
export const myReviewSchema = z
    .object({
        /** They may write (or change) a review: they bought the model, received a print or downloaded it free. */
        eligible: z.boolean(),
        /** Their review, if they wrote one. `hidden`: the shop hid it, so only they see it. */
        review: reviewSchema.extend({ hidden: z.boolean() }).nullable(),
    })
    .meta({ id: 'MyReview' });
export type MyReview = z.infer<typeof myReviewSchema>;

/**
 * How a review's author is named in public: the first name and the initial of the last ("Aino Korhonen" →
 * "Aino K."). A single name (or a username) is shown as it is.
 */
export function reviewAuthorName(displayName: string | null): string {
    const words = displayName?.trim().split(/\s+/).filter(Boolean) ?? [];
    if (words.length === 0) return 'A customer';
    if (words.length === 1) return words[0]!;
    const last = words.at(-1)!;
    // The first character as people see it, even if it's made of several code points (an accented letter).
    const [initial] = new Intl.Segmenter('en-IE', { granularity: 'grapheme' }).segment(last);
    return `${words[0]} ${initial!.segment.toLocaleUpperCase('en-IE')}.`;
}

// ---------------------------------------------------------------------------
// Admin

export const REVIEW_VISIBILITIES = ['visible', 'hidden'] as const;
export const reviewVisibilitySchema = z.enum(REVIEW_VISIBILITIES);
export type ReviewVisibility = z.infer<typeof reviewVisibilitySchema>;

export const adminReviewListQuerySchema = z.object({
    /** Without it, every review. */
    visibility: reviewVisibilitySchema.optional(),
    /** Matches part of the text, the model's title, or the author's name or email. */
    q: z.string().trim().min(1).max(100).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type AdminReviewListQuery = z.infer<typeof adminReviewListQuerySchema>;

export const adminReviewSchema = reviewSchema
    .extend({
        hiddenAt: timestampSchema.nullable(),
        product: z.object({ id: z.uuid(), slug: z.string(), title: z.string(), listed: z.boolean() }),
        /** Who wrote it, for the shop's eyes only. */
        user: z.object({ id: z.string(), email: z.email(), displayName: z.string().nullable() }),
    })
    .meta({ id: 'AdminReview' });
export type AdminReview = z.infer<typeof adminReviewSchema>;

export const adminReviewListSchema = z
    .object({
        reviews: z.array(adminReviewSchema),
        page: z.int(),
        pageSize: z.int(),
        total: z.int(),
    })
    .meta({ id: 'AdminReviewList' });
export type AdminReviewList = z.infer<typeof adminReviewListSchema>;

/** Hides a review from the model's page and its rating, or shows it again. */
export const setReviewHiddenSchema = z.object({ hidden: z.boolean() }).meta({ id: 'SetReviewHidden' });
export type SetReviewHidden = z.infer<typeof setReviewHiddenSchema>;
