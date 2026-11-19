import type { RatingSummary } from '@app/shared';
import { cn } from 'cn';
import { Star } from 'lucide-react';

const STARS = [1, 2, 3, 4, 5] as const;

/** Five stars filled up to `value` (fractions too). Decorative: say the rating in text next to it. */
export function Stars({ value, className }: { value: number; className?: string }) {
    const filled = `${(Math.min(Math.max(value, 0), 5) / 5) * 100}%`;
    return (
        <span
            aria-hidden
            className={cn('relative inline-flex shrink-0 [&_svg]:size-[1em] [&_svg]:shrink-0', className)}
        >
            <span className='flex text-border'>
                {STARS.map((star) => (
                    <Star key={star} className='fill-current' strokeWidth={0} />
                ))}
            </span>
            <span className='absolute inset-y-0 left-0 flex overflow-hidden text-foreground' style={{ width: filled }}>
                {STARS.map((star) => (
                    <Star key={star} className='fill-current' strokeWidth={0} />
                ))}
            </span>
        </span>
    );
}

/** `4.7`, with the dot as the shop writes decimals. */
export const formatRating = (average: number) => average.toFixed(1);

export const reviewCount = (count: number) => `${count.toLocaleString('en-IE')} ${count === 1 ? 'review' : 'reviews'}`;

/** "★★★★☆ 4.7 (3 reviews)": a model's rating, for its page. */
export function RatingLine({ rating, className }: { rating: RatingSummary; className?: string }) {
    return (
        <span className={cn('inline-flex items-center gap-1.5 text-sm', className)}>
            <Stars value={rating.average} />
            <span>
                <span className='font-medium'>{formatRating(rating.average)}</span>
                <span className='sr-only'> out of 5</span>{' '}
                <span className='text-muted-foreground'>({reviewCount(rating.count)})</span>
            </span>
        </span>
    );
}
