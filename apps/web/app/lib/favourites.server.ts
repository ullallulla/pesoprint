import { favouriteListSchema, favouriteStatusSchema, type Favourite } from '@app/shared';
import { getAuth } from '@clerk/react-router/server';
import type { LoaderFunctionArgs } from 'react-router';

import { apiFetch } from '~/lib/api.server';

/** The visitor's saved models. `null` for a visitor who isn't signed in. */
export async function getFavourites(args: LoaderFunctionArgs): Promise<Favourite[] | null> {
    const { isAuthenticated, getToken } = await getAuth(args);
    if (!isAuthenticated) return null;
    const { items } = await apiFetch('/api/favourites', favouriteListSchema, { token: await getToken() });
    return items;
}

/** Whether the visitor saved the model. `null` for a visitor who isn't signed in. */
export async function isFavourite(args: LoaderFunctionArgs, productId: string): Promise<boolean | null> {
    const { isAuthenticated, getToken } = await getAuth(args);
    if (!isAuthenticated) return null;
    const { saved } = await apiFetch(`/api/favourites/${encodeURIComponent(productId)}`, favouriteStatusSchema, {
        token: await getToken(),
    });
    return saved;
}

/** Saves the model, or forgets it. */
export async function setFavourite(token: string | null, productId: string, saved: boolean): Promise<boolean> {
    const status = await apiFetch(`/api/favourites/${encodeURIComponent(productId)}`, favouriteStatusSchema, {
        method: saved ? 'PUT' : 'DELETE',
        token,
    });
    return status.saved;
}
