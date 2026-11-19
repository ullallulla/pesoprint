import { SignInButton } from '@clerk/react-router';
import { cn } from 'cn';
import { Heart } from 'lucide-react';
import { useFetcher } from 'react-router';

import { Button } from '~/components/ui/button';

/**
 * The heart that saves a model to the visitor's favourites. `saved` is `null` for a visitor who isn't signed in:
 * the heart then opens sign-in. It posts to the current page's action (intent `favourite`), and shows the new
 * state as soon as it's sent.
 */
export function FavouriteButton({
    saved,
    productId,
    modelTitle,
    className,
}: {
    saved: boolean | null;
    /** Sent with the form when the page's action serves several models (the favourites page). */
    productId?: string;
    /** Names the model in the button's label, where several hearts share a page. */
    modelTitle?: string;
    className?: string;
}) {
    const fetcher = useFetcher<{ error: string | null }>();
    const what = modelTitle ? `${modelTitle} ` : '';
    const label = `Save ${what}to favourites`;

    if (saved === null) {
        return (
            <SignInButton mode='modal'>
                <Button
                    variant='outline'
                    size='icon'
                    aria-label={`Sign in to save ${what}to favourites`}
                    className={className}
                >
                    <Heart aria-hidden />
                </Button>
            </SignInButton>
        );
    }

    const pending = fetcher.formData?.get('save');
    const isSaved = pending === undefined || pending === null ? saved : pending === 'true';
    const error = fetcher.state === 'idle' ? fetcher.data?.error : null;

    return (
        <fetcher.Form method='post' className={cn('relative', className)}>
            {productId && <input type='hidden' name='productId' value={productId} />}
            <input type='hidden' name='save' value={String(!isSaved)} />
            <Button
                type='submit'
                name='intent'
                value='favourite'
                variant='outline'
                size='icon'
                aria-pressed={isSaved}
                aria-label={label}
                title={isSaved ? 'Saved to your favourites' : 'Save to favourites'}
            >
                <Heart aria-hidden className={cn(isSaved && 'fill-current text-destructive')} />
            </Button>
            {error && (
                <p role='alert' className='absolute top-full right-0 mt-1 w-56 text-right text-xs text-destructive'>
                    {error}
                </p>
            )}
        </fetcher.Form>
    );
}
