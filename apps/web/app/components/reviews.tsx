import {
    REVIEW_BODY_MAX_LENGTH,
    type MyReview,
    type ProductReviews,
    type RatingSummary,
    type Review,
} from '@app/shared';
import { SignInButton } from '@clerk/react-router';
import { cn } from 'cn';
import { EyeOff, Star } from 'lucide-react';
import { useState } from 'react';
import { useFetcher } from 'react-router';

import { Pagination } from '~/components/catalog/pagination';
import { formatRating, reviewCount, Stars } from '~/components/rating-stars';
import { Button } from '~/components/ui/button';
import { Label } from '~/components/ui/label';
import { Textarea } from '~/components/ui/textarea';
import { formatDate } from '~/lib/format';

/** What the product page's action answers a review or favourite form with. */
type FormResult = { error: string | null };

const RATING_WORDS: Record<number, string> = { 1: 'Poor', 2: 'Fair', 3: 'Good', 4: 'Very good', 5: 'Excellent' };

export const WHO_MAY_REVIEW = 'Reviews are by people who bought the model, received a print of it or downloaded it.';

interface ReviewsSectionProps {
    rating: RatingSummary | null;
    page: ProductReviews;
    /** The visitor's own review and whether they may write one. `null` if they aren't signed in. */
    mine: MyReview | null;
    /** The link to a page of reviews. */
    href: (page: number) => string;
}

/** The model page's reviews: the average, the visitor's own review or the form to write one, then everyone's. */
export function ReviewsSection({ rating, page, mine, href }: ReviewsSectionProps) {
    const ownId = mine?.review?.id;
    // The visitor's own review is shown in its own place, not again in the list.
    const others = page.reviews.filter((review) => review.id !== ownId);
    const pageCount = Math.max(1, Math.ceil(page.total / page.pageSize));

    return (
        <section id='reviews' aria-labelledby='reviews-heading' className='flex max-w-3xl scroll-mt-24 flex-col gap-6'>
            <div className='flex flex-col gap-1'>
                <h2 id='reviews-heading' className='text-xl font-semibold'>
                    Reviews
                </h2>
                {rating ? (
                    <p className='flex items-center gap-2'>
                        <Stars value={rating.average} className='text-lg' />
                        <span>
                            <span className='font-medium'>{formatRating(rating.average)} out of 5</span>{' '}
                            <span className='text-muted-foreground'>· {reviewCount(rating.count)}</span>
                        </span>
                    </p>
                ) : null}
                <p className='text-sm text-muted-foreground'>{WHO_MAY_REVIEW}</p>
            </div>

            <YourReview mine={mine} />

            {others.length > 0 ? (
                <ul className='flex flex-col divide-y'>
                    {others.map((review) => (
                        <li key={review.id} className='py-4 first:pt-0'>
                            <ReviewBody review={review} />
                        </li>
                    ))}
                </ul>
            ) : (
                !rating && !mine?.review && <p className='text-muted-foreground'>No reviews yet.</p>
            )}

            <Pagination page={page.page} pageCount={pageCount} href={href} />
        </section>
    );
}

function ReviewBody({ review, author }: { review: Review; author?: string }) {
    return (
        <article className='flex flex-col gap-1.5'>
            <p className='flex flex-wrap items-center gap-x-2 gap-y-1 text-sm'>
                <Stars value={review.rating} />
                <span className='sr-only'>
                    Rated {review.rating} out of 5{review.body ? '.' : ''}
                </span>
                <span className='font-medium'>{author ?? review.author}</span>
                <span className='text-muted-foreground'>
                    <time dateTime={review.createdAt}>{formatDate(review.createdAt)}</time>
                    {review.editedAt && ' · edited'}
                </span>
            </p>
            {review.body && <p className='text-sm whitespace-pre-line'>{review.body}</p>}
        </article>
    );
}

/** The visitor's part: sign in, write a review, or theirs with ways to change or delete it. */
function YourReview({ mine }: { mine: MyReview | null }) {
    if (mine === null) {
        return (
            <div className='flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4'>
                <p className='text-sm'>Have this model? Sign in to review it.</p>
                <SignInButton mode='modal'>
                    <Button variant='outline' size='sm'>
                        Sign in
                    </Button>
                </SignInButton>
            </div>
        );
    }

    const { review, eligible } = mine;
    if (!review) {
        if (!eligible) return null;
        return (
            <div className='flex flex-col gap-3 rounded-lg border p-4'>
                <h3 className='font-medium'>Write a review</h3>
                <ReviewForm />
            </div>
        );
    }

    return (
        <div className='flex flex-col gap-3 rounded-lg border p-4'>
            <h3 className='text-sm font-medium text-muted-foreground'>Your review</h3>
            {review.hidden && (
                <p className='flex items-start gap-2 rounded-md bg-muted p-3 text-sm'>
                    <EyeOff className='mt-0.5 size-4 shrink-0' aria-hidden />
                    The shop has hidden this review, so only you can see it. Changing it won&apos;t show it again.
                </p>
            )}
            <ReviewBody review={review} author='You' />
            {eligible && (
                <details className='group'>
                    <summary className='cursor-pointer text-sm font-medium underline-offset-4 hover:underline'>
                        Change your review
                    </summary>
                    <div className='pt-3'>
                        <ReviewForm review={review} />
                    </div>
                </details>
            )}
            <DeleteReview />
        </div>
    );
}

/**
 * Stars and text. The stars are radio buttons, so the form works before JavaScript loads; once it runs, they
 * fill up to the one chosen.
 */
function ReviewForm({ review }: { review?: Review }) {
    const fetcher = useFetcher<FormResult>();
    const [rating, setRating] = useState<number | null>(review?.rating ?? null);
    const saving = fetcher.state !== 'idle';
    const error = fetcher.state === 'idle' ? fetcher.data?.error : null;

    return (
        <fetcher.Form method='post' className='flex flex-col gap-4'>
            <fieldset className='flex flex-col gap-1.5'>
                <legend className='mb-1.5 text-sm font-medium'>Your rating</legend>
                <div className='flex items-center gap-3'>
                    <div className='flex'>
                        {([1, 2, 3, 4, 5] as const).map((value) => (
                            <label key={value} className='cursor-pointer p-0.5'>
                                <input
                                    type='radio'
                                    name='rating'
                                    value={value}
                                    required
                                    checked={rating === value}
                                    onChange={() => setRating(value)}
                                    className='peer sr-only'
                                />
                                <Star
                                    aria-hidden
                                    className={cn(
                                        'size-7 rounded-sm peer-checked:fill-current peer-checked:text-foreground peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring',
                                        rating !== null && value <= rating
                                            ? 'fill-current text-foreground'
                                            : 'text-muted-foreground',
                                    )}
                                />
                                <span className='sr-only'>
                                    {value} {value === 1 ? 'star' : 'stars'}: {RATING_WORDS[value]}
                                </span>
                            </label>
                        ))}
                    </div>
                    <span className='text-sm text-muted-foreground' aria-hidden>
                        {rating !== null && RATING_WORDS[rating]}
                    </span>
                </div>
            </fieldset>
            <div className='flex flex-col gap-1.5'>
                <Label htmlFor='review-body'>
                    Your review <span className='font-normal text-muted-foreground'>(optional)</span>
                </Label>
                <Textarea
                    id='review-body'
                    name='body'
                    defaultValue={review?.body}
                    maxLength={REVIEW_BODY_MAX_LENGTH}
                    rows={4}
                    placeholder='How did it print, and how is it to use?'
                />
                <p className='text-xs text-muted-foreground'>
                    Shown with your first name and the initial of your last name.
                </p>
            </div>
            <div className='flex items-center gap-3'>
                <Button type='submit' name='intent' value='save-review' disabled={saving}>
                    {review ? 'Save changes' : 'Post review'}
                </Button>
                {error && (
                    <p role='alert' className='text-sm text-destructive'>
                        {error}
                    </p>
                )}
            </div>
        </fetcher.Form>
    );
}

function DeleteReview() {
    const fetcher = useFetcher<FormResult>();
    const error = fetcher.state === 'idle' ? fetcher.data?.error : null;
    return (
        <fetcher.Form
            method='post'
            onSubmit={(event) => {
                if (!window.confirm('Delete your review?')) event.preventDefault();
            }}
            className='flex items-center gap-3'
        >
            <Button
                type='submit'
                name='intent'
                value='delete-review'
                variant='link'
                size='sm'
                className='h-auto px-0 text-muted-foreground'
                disabled={fetcher.state !== 'idle'}
            >
                Delete your review
            </Button>
            {error && (
                <p role='alert' className='text-sm text-destructive'>
                    {error}
                </p>
            )}
        </fetcher.Form>
    );
}
