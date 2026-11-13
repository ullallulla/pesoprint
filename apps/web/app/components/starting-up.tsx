import { LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useRevalidator } from 'react-router';

import { Button } from '~/components/ui/button';

/** Seconds between attempts. Each attempt can itself wait for the API to answer while it wakes. */
const RETRY_SECONDS = 5;
/** Waking normally takes under a minute. After this many attempts (several minutes), stop and say so. */
const MAX_ATTEMPTS = 12;

/**
 * Shown when the API can't be reached: on a free host it sleeps when nobody visits, and the first visit
 * wakes it. Tries the page again by itself, and shows the page as soon as the API answers.
 */
export function StartingUp() {
    const { revalidate, state } = useRevalidator();
    const [attempts, setAttempts] = useState(0);
    const givenUp = attempts >= MAX_ATTEMPTS;

    useEffect(() => {
        if (givenUp || state !== 'idle') return;
        const timer = setTimeout(() => {
            setAttempts((count) => count + 1);
            void revalidate();
        }, RETRY_SECONDS * 1000);
        return () => clearTimeout(timer);
    }, [attempts, givenUp, revalidate, state]);

    return (
        <main className='mx-auto flex w-full max-w-7xl flex-1 flex-col items-start gap-4 px-4 py-16'>
            {givenUp ? (
                <>
                    <h1 className='text-3xl font-bold'>This is taking longer than usual</h1>
                    <p className='text-muted-foreground'>
                        The site still isn&apos;t answering. It may be down for a moment. Try again in a few minutes.
                    </p>
                    <Button
                        variant='outline'
                        onClick={() => {
                            setAttempts(0);
                            void revalidate();
                        }}
                    >
                        Try again
                    </Button>
                </>
            ) : (
                <>
                    <h1 className='flex items-center gap-3 text-3xl font-bold'>
                        <LoaderCircle className='size-7 animate-spin text-muted-foreground' aria-hidden />
                        The site is starting up
                    </h1>
                    <p className='max-w-prose text-muted-foreground'>
                        This usually takes under a minute. The page will load by itself as soon as it&apos;s ready.
                    </p>
                </>
            )}
        </main>
    );
}
