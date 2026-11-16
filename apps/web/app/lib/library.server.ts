import { libraryItemSchema, librarySchema, type LibraryItem } from '@app/shared';
import { getAuth } from '@clerk/react-router/server';
import type { LoaderFunctionArgs } from 'react-router';

import { apiFetch, ApiRequestError } from '~/lib/api.server';

/** Everything the signed-in visitor owns. `null` for a visitor who isn't signed in. */
export async function getLibrary(args: LoaderFunctionArgs): Promise<LibraryItem[] | null> {
    const { isAuthenticated, getToken } = await getAuth(args);
    if (!isAuthenticated) return null;
    const { items } = await apiFetch('/api/library', librarySchema, { token: await getToken() });
    return items;
}

/** The model as the visitor owns it, with its files. `null` if they don't own it, or aren't signed in. */
export async function getOwned(args: LoaderFunctionArgs, productId: string): Promise<LibraryItem | null> {
    const { isAuthenticated, getToken } = await getAuth(args);
    if (!isAuthenticated) return null;
    try {
        return await apiFetch(`/api/library/${encodeURIComponent(productId)}`, libraryItemSchema, {
            token: await getToken(),
        });
    } catch (error) {
        if (error instanceof ApiRequestError && error.status === 404) return null;
        throw error;
    }
}
