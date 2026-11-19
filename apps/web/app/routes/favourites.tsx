import { SignInButton } from '@clerk/react-router';
import { getAuth } from '@clerk/react-router/server';
import { Heart } from 'lucide-react';
import { data, Link, redirect } from 'react-router';
import { z } from 'zod';

import { ProductCard } from '~/components/catalog/product-card';
import { FavouriteButton } from '~/components/favourite-button';
import { Button } from '~/components/ui/button';
import { ApiRequestError } from '~/lib/api.server';
import { getFavourites, setFavourite } from '~/lib/favourites.server';

import type { Route } from './+types/favourites';

export const meta: Route.MetaFunction = () => [
    { title: 'Your favourites – Pesoprint' },
    { name: 'robots', content: 'noindex' },
];

/** `/favourites`: the models the visitor saved with the heart. `items` is `null` when they aren't signed in. */
export async function loader(args: Route.LoaderArgs) {
    return { items: await getFavourites(args) };
}

/** The hearts on this page: un-saving a model takes it off the list (saving it again puts it back). */
export async function action(args: Route.ActionArgs) {
    const form = await args.request.formData();
    const productId = z.uuid().safeParse(form.get('productId'));
    if (form.get('intent') !== 'favourite' || !productId.success) throw data('Unknown action', { status: 400 });

    const { isAuthenticated, getToken } = await getAuth(args);
    if (!isAuthenticated) return { error: 'Sign in first.' };
    try {
        await setFavourite(await getToken(), productId.data, form.get('save') === 'true');
    } catch (error) {
        if (error instanceof ApiRequestError && [404, 409].includes(error.status)) return { error: error.message };
        throw error;
    }
    return args.request.headers.get('sec-fetch-mode') === 'navigate' ? redirect('/favourites') : { error: null };
}

export default function FavouritesPage({ loaderData }: Route.ComponentProps) {
    const { items } = loaderData;
    return (
        <main className='mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-10'>
            {items === null ? (
                <>
                    <h1 className='text-3xl font-bold tracking-tight'>Sign in to see your favourites</h1>
                    <p className='text-muted-foreground'>Save models with the heart to find them again later.</p>
                    <SignInButton mode='modal'>
                        <Button className='self-start'>Sign in</Button>
                    </SignInButton>
                </>
            ) : (
                <>
                    <div className='flex flex-col gap-2'>
                        <h1 className='text-3xl font-bold tracking-tight'>Your favourites</h1>
                        <p className='text-muted-foreground'>Models you saved, the most recent first.</p>
                    </div>
                    {items.length === 0 ? (
                        <div className='flex flex-col items-start gap-4'>
                            <p className='flex items-center gap-2 text-muted-foreground'>
                                Nothing saved yet. Tap the <Heart className='size-4' aria-label='heart' /> on a model to
                                save it here.
                            </p>
                            <Button asChild variant='outline'>
                                <Link to='/models'>Browse models</Link>
                            </Button>
                        </div>
                    ) : (
                        <ul className='grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
                            {items.map((item, index) => (
                                <li key={item.productId} className='relative flex'>
                                    <ProductCard product={item.product} eager={index < 4} />
                                    {/* Above the card's full-size link, so it can be pressed on its own. */}
                                    <FavouriteButton
                                        saved
                                        productId={item.productId}
                                        modelTitle={item.product.title}
                                        className='absolute top-2 right-2 z-10 [&_button]:bg-background/90'
                                    />
                                </li>
                            ))}
                        </ul>
                    )}
                </>
            )}
        </main>
    );
}
