import type { LibraryItem } from '@app/shared';
import { SignInButton } from '@clerk/react-router';
import { Box } from 'lucide-react';
import { Link } from 'react-router';

import { FileDownloads } from '~/components/file-downloads';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { formatDate } from '~/lib/format';
import { getLibrary } from '~/lib/library.server';

import type { Route } from './+types/library';

export const meta: Route.MetaFunction = () => [
    { title: 'Your library – Pesoprint' },
    { name: 'robots', content: 'noindex' },
];

/** `/library`: every model the visitor bought, with its files. `items` is `null` when they aren't signed in. */
export async function loader(args: Route.LoaderArgs) {
    return { items: await getLibrary(args) };
}

export default function LibraryPage({ loaderData }: Route.ComponentProps) {
    const { items } = loaderData;
    return (
        <main className='mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10'>
            {items === null ? (
                <>
                    <h1 className='text-3xl font-bold tracking-tight'>Sign in to see your library</h1>
                    <p className='text-muted-foreground'>The models you buy are kept here, ready to download.</p>
                    <SignInButton mode='modal'>
                        <Button className='self-start'>Sign in</Button>
                    </SignInButton>
                </>
            ) : (
                <>
                    <div className='flex flex-col gap-2'>
                        <h1 className='text-3xl font-bold tracking-tight'>Your library</h1>
                        <p className='text-muted-foreground'>
                            The models you&apos;ve bought. Download them as often as you like.
                        </p>
                    </div>
                    {items.length === 0 ? (
                        <div className='flex flex-col items-start gap-4'>
                            <p className='text-muted-foreground'>You haven&apos;t bought any models yet.</p>
                            <Button asChild variant='outline'>
                                <Link to='/models'>Browse models</Link>
                            </Button>
                        </div>
                    ) : (
                        <ul className='flex flex-col gap-4'>
                            {items.map((item) => (
                                <LibraryEntry key={item.productId} item={item} />
                            ))}
                        </ul>
                    )}
                </>
            )}
        </main>
    );
}

function LibraryEntry({ item }: { item: LibraryItem }) {
    const cover = item.cover ? (
        <img
            src={item.cover.url}
            alt=''
            width={item.cover.width}
            height={item.cover.height}
            className='size-full object-cover'
        />
    ) : (
        <div className='flex size-full items-center justify-center text-muted-foreground'>
            <Box className='size-6' />
        </div>
    );
    const thumbnailClass = 'aspect-[4/3] w-24 shrink-0 overflow-hidden rounded-md bg-muted';

    return (
        <li className='flex flex-col gap-4 rounded-lg border p-4 sm:flex-row'>
            {/* An archived model has no page to link to, but its files are still the buyer's. */}
            {item.listed ? (
                <Link to={`/models/${item.slug}`} tabIndex={-1} aria-hidden className={thumbnailClass}>
                    {cover}
                </Link>
            ) : (
                <div aria-hidden className={thumbnailClass}>
                    {cover}
                </div>
            )}
            <div className='flex min-w-0 flex-1 flex-col gap-3'>
                <div className='flex flex-col gap-1'>
                    <h2 className='flex flex-wrap items-center gap-2 font-medium'>
                        {item.listed ? (
                            <Link to={`/models/${item.slug}`} className='hover:underline'>
                                {item.title}
                            </Link>
                        ) : (
                            item.title
                        )}
                        {!item.listed && <Badge variant='secondary'>No longer sold</Badge>}
                    </h2>
                    <p className='text-sm text-muted-foreground'>
                        {item.orderId ? 'Bought' : 'Added'} {formatDate(item.acquiredAt)}
                        {item.orderId && (
                            <>
                                {' · '}
                                <Link
                                    to={`/orders/${item.orderId}`}
                                    className='underline underline-offset-4 hover:text-foreground'
                                >
                                    View order
                                </Link>
                            </>
                        )}
                    </p>
                </div>
                {item.files.length === 0 ? (
                    <p className='text-sm text-muted-foreground'>
                        This model has no files right now. Contact us and we&apos;ll sort it out.
                    </p>
                ) : (
                    <FileDownloads slug={item.slug} files={item.files} />
                )}
            </div>
        </li>
    );
}
