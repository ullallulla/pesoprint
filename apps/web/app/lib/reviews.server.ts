import {
    myReviewSchema,
    productReviewsSchema,
    type MyReview,
    type ProductReviews,
    type ReviewInput,
} from '@app/shared';
import { getAuth } from '@clerk/react-router/server';
import type { LoaderFunctionArgs } from 'react-router';
import { z } from 'zod';

import { apiFetch } from '~/lib/api.server';

/** How many reviews the model page shows at a time. */
export const REVIEWS_PAGE_SIZE = 10;

/** One page of a model's reviews, newest first. */
export function getReviews(slug: string, page: number): Promise<ProductReviews> {
    const query = new URLSearchParams({ page: String(page), pageSize: String(REVIEWS_PAGE_SIZE) });
    return apiFetch(`/api/catalog/products/${encodeURIComponent(slug)}/reviews?${query}`, productReviewsSchema);
}

/** The visitor's review of the model and whether they may write one. `null` if they aren't signed in. */
export async function getMyReview(args: LoaderFunctionArgs, productId: string): Promise<MyReview | null> {
    const { isAuthenticated, getToken } = await getAuth(args);
    if (!isAuthenticated) return null;
    return apiFetch(`/api/me/reviews/${encodeURIComponent(productId)}`, myReviewSchema, { token: await getToken() });
}

/** Writes the visitor's review, or replaces theirs. The API refuses (403) anyone who may not review the model. */
export async function saveReview(token: string | null, productId: string, review: ReviewInput): Promise<MyReview> {
    return apiFetch(`/api/me/reviews/${encodeURIComponent(productId)}`, myReviewSchema, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(review),
        token,
    });
}

export async function deleteReview(token: string | null, productId: string): Promise<void> {
    await apiFetch(`/api/me/reviews/${encodeURIComponent(productId)}`, z.undefined(), { method: 'DELETE', token });
}
