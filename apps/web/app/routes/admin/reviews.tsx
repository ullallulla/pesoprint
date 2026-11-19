import { adminReviewListSchema, adminReviewSchema, type AdminReview, type ReviewVisibility } from '@app/shared';
import { Eye, EyeOff, Search } from 'lucide-react';
import { Form, Link, useFetcher } from 'react-router';
import { z } from 'zod';

import { Pagination } from '~/components/catalog/pagination';
import { Stars } from '~/components/rating-stars';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { adminApi, invalid, runAction, type ActionResult } from '~/lib/admin.server';
import { formatDate } from '~/lib/format';

import type { Route } from './+types/reviews';

export const meta: Route.MetaFunction = () => [
    { title: 'Reviews – Admin – Pesoprint' },
    { name: 'robots', content: 'noindex' },
];

const PAGE_SIZE = 25;

const TABS = [
    { value: 'all', label: 'All' },
    { value: 'visible', label: 'Shown' },
    { value: 'hidden', label: 'Hidden' },
] as const satisfies readonly { value: ReviewVisibility | 'all'; label: string }[];
type Tab = (typeof TABS)[number]['value'];

const EMPTY_MESSAGES: Record<Tab, string> = {
    all: 'No reviews yet. Buyers can review the models they have.',
    visible: 'No reviews are shown.',
    hidden: 'No hidden reviews.',
};

/** Reads the filters from the URL, ignoring values that aren't valid (a hand-edited URL shouldn't error). */
function parseFilters(url: URL) {
    const visibility = TABS.find((tab) => tab.value === url.searchParams.get('visibility'))?.value ?? 'all';
    const page = Number(url.searchParams.get('page'));
    return {
        visibility,
        q: url.searchParams.get('q')?.trim().slice(0, 100) || undefined,
        page: Number.isInteger(page) && page > 1 ? page : 1,
    };
}

export async function loader(args: Route.LoaderArgs) {
    const filters = parseFilters(new URL(args.request.url));
    const query = new URLSearchParams({ page: String(filters.page), pageSize: String(PAGE_SIZE) });
    if (filters.visibility !== 'all') query.set('visibility', filters.visibility);
    if (filters.q) query.set('q', filters.q);

    const list = await adminApi(args, `/api/admin/reviews?${query}`, adminReviewListSchema);
    return { list, filters };
}

/** Hide or show one review. */
export async function action(args: Route.ActionArgs): Promise<ActionResult> {
    const form = await args.request.formData();
    const intent = form.get('intent');
    const reviewId = z.uuid().safeParse(form.get('reviewId'));
    if ((intent !== 'hide' && intent !== 'show') || !reviewId.success) return invalid([], 'Unknown action.');

    return runAction(async () => {
        await adminApi(args, `/api/admin/reviews/${reviewId.data}/visibility`, adminReviewSchema, {
            method: 'POST',
            json: { hidden: intent === 'hide' },
        });
        return intent === 'hide' ? 'Review hidden.' : 'Review shown again.';
    });
}

export default function AdminReviews({ loaderData }: Route.ComponentProps) {
    const { list, filters } = loaderData;
    const pageCount = Math.max(1, Math.ceil(list.total / list.pageSize));

    const href = (changes: { visibility?: Tab; page?: number }) => {
        const params = new URLSearchParams();
        const visibility = changes.visibility ?? filters.visibility;
        if (visibility !== 'all') params.set('visibility', visibility);
        if (filters.q) params.set('q', filters.q);
        if (changes.page && changes.page > 1) params.set('page', String(changes.page));
        const search = params.toString();
        return search ? `/admin/reviews?${search}` : '/admin/reviews';
    };

    return (
        <main className='flex flex-col gap-6'>
            <div className='space-y-1'>
                <h1 className='text-3xl font-bold tracking-tight'>Reviews</h1>
                <p className='text-muted-foreground'>
                    Every review, newest first. A hidden review leaves the model&apos;s page and its rating; only its
                    author still sees it.
                </p>
            </div>

            <div className='flex flex-wrap items-center justify-between gap-4'>
                <nav aria-label='Visibility' className='flex flex-wrap gap-1'>
                    {TABS.map((tab) => {
                        const current = filters.visibility === tab.value;
                        return (
                            <Button key={tab.value} asChild size='sm' variant={current ? 'secondary' : 'ghost'}>
                                <Link to={href({ visibility: tab.value })} aria-current={current ? 'page' : undefined}>
                                    {tab.label}
                                </Link>
                            </Button>
                        );
                    })}
                </nav>
                <search>
                    <Form method='get' className='flex gap-2'>
                        {filters.visibility !== 'all' && (
                            <input type='hidden' name='visibility' value={filters.visibility} />
                        )}
                        <Input
                            type='search'
                            name='q'
                            defaultValue={filters.q}
                            placeholder='Text, model, name or email'
                            aria-label='Search reviews'
                            className='w-64'
                        />
                        <Button type='submit' variant='outline' size='icon' aria-label='Search'>
                            <Search aria-hidden />
                        </Button>
                    </Form>
                </search>
            </div>

            {list.reviews.length === 0 ? (
                <p className='rounded-lg border border-dashed p-8 text-center text-muted-foreground'>
                    {filters.q ? 'No reviews match.' : EMPTY_MESSAGES[filters.visibility]}
                </p>
            ) : (
                <ul className='flex flex-col divide-y rounded-lg border'>
                    {list.reviews.map((review) => (
                        <ReviewRow key={review.id} review={review} />
                    ))}
                </ul>
            )}

            <Pagination page={list.page} pageCount={pageCount} href={(page) => href({ page })} />
        </main>
    );
}

function ReviewRow({ review }: { review: AdminReview }) {
    const fetcher = useFetcher<typeof action>();
    const hidden = review.hiddenAt !== null;
    const error = fetcher.state === 'idle' && fetcher.data && !fetcher.data.ok ? fetcher.data.message : null;

    return (
        <li className='flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between'>
            <div className='flex min-w-0 flex-col gap-1.5'>
                <p className='flex flex-wrap items-center gap-x-2 gap-y-1 text-sm'>
                    <Stars value={review.rating} />
                    <span className='sr-only'>Rated {review.rating} out of 5.</span>
                    {review.product.listed ? (
                        <Link to={`/models/${review.product.slug}`} className='font-medium hover:underline'>
                            {review.product.title}
                        </Link>
                    ) : (
                        <span className='font-medium'>{review.product.title}</span>
                    )}
                    {hidden && <Badge variant='secondary'>Hidden</Badge>}
                </p>
                {review.body ? (
                    <p className='text-sm whitespace-pre-line'>{review.body}</p>
                ) : (
                    <p className='text-sm text-muted-foreground italic'>No text, only a rating.</p>
                )}
                <p className='text-xs text-muted-foreground'>
                    {review.user.displayName ?? 'No name'} · {review.user.email} · shown as {review.author} ·{' '}
                    <time dateTime={review.createdAt}>{formatDate(review.createdAt)}</time>
                    {review.editedAt && ' · edited'}
                    {review.hiddenAt && (
                        <>
                            {' · hidden '}
                            <time dateTime={review.hiddenAt}>{formatDate(review.hiddenAt)}</time>
                        </>
                    )}
                </p>
            </div>
            <fetcher.Form method='post' className='flex shrink-0 flex-col items-start gap-1 sm:items-end'>
                <input type='hidden' name='reviewId' value={review.id} />
                <Button
                    type='submit'
                    name='intent'
                    value={hidden ? 'show' : 'hide'}
                    variant='outline'
                    size='sm'
                    disabled={fetcher.state !== 'idle'}
                >
                    {hidden ? <Eye aria-hidden /> : <EyeOff aria-hidden />}
                    {hidden ? 'Show' : 'Hide'}
                </Button>
                {error && (
                    <p role='alert' className='text-xs text-destructive'>
                        {error}
                    </p>
                )}
            </fetcher.Form>
        </li>
    );
}
