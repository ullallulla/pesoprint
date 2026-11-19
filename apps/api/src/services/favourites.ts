import { MAX_FAVOURITES, type Favourite, type FavouriteStatus } from '@app/shared';
import { and, count, desc, eq } from 'drizzle-orm';

import type { Database } from '../db/client.ts';
import { isPgError, PgErrorCode } from '../db/errors.ts';
import { categories, favourites, products } from '../db/schema.ts';
import type { AuthContext } from '../lib/auth.ts';
import { conflict, notFound } from '../lib/errors.ts';
import type { Storage } from '../lib/storage.ts';
import { cardColumns, productCards } from './catalog.ts';

/** The models a user saved with the heart button. */
export interface FavouritesService {
    /** The caller's saved models that are published, most recently saved first. */
    list(caller: AuthContext): Promise<Favourite[]>;
    status(caller: AuthContext, productId: string): Promise<FavouriteStatus>;
    /** Saves a published model. Saving it again changes nothing; past the limit it's refused (409). */
    save(caller: AuthContext, productId: string): Promise<FavouriteStatus>;
    /** Forgets a saved model, if it was saved. */
    remove(caller: AuthContext, productId: string): Promise<FavouriteStatus>;
}

const isPublished = eq(products.status, 'published');

export function createFavouritesService(db: Database, storage: Storage | null): FavouritesService {
    const saved = async (caller: AuthContext, productId: string) => {
        const [row] = await db
            .select({ productId: favourites.productId })
            .from(favourites)
            .where(and(eq(favourites.userId, caller.userId), eq(favourites.productId, productId)));
        return row !== undefined;
    };

    return {
        async list(caller) {
            // Archived models drop out of the list, but stay saved in case they come back.
            const rows = await db
                .select({ ...cardColumns, savedAt: favourites.createdAt })
                .from(favourites)
                .innerJoin(products, eq(products.id, favourites.productId))
                .leftJoin(categories, eq(categories.id, products.categoryId))
                .where(and(eq(favourites.userId, caller.userId), isPublished))
                .orderBy(desc(favourites.createdAt), desc(products.id));
            const cards = await productCards(db, storage, rows);
            return rows.map((row, index) => ({
                productId: row.id,
                savedAt: row.savedAt.toISOString(),
                product: cards[index]!,
            }));
        },

        async status(caller, productId) {
            return { saved: await saved(caller, productId) };
        },

        async save(caller, productId) {
            const [product] = await db
                .select({ id: products.id })
                .from(products)
                .where(and(eq(products.id, productId), isPublished));
            if (!product) throw notFound('Model not found.');
            if (await saved(caller, productId)) return { saved: true };

            const [total] = await db
                .select({ value: count() })
                .from(favourites)
                .where(eq(favourites.userId, caller.userId));
            if ((total?.value ?? 0) >= MAX_FAVOURITES) {
                throw conflict(`You can save up to ${MAX_FAVOURITES} models. Remove some to save more.`);
            }
            try {
                await db.insert(favourites).values({ userId: caller.userId, productId }).onConflictDoNothing();
            } catch (error) {
                // The Clerk webhook that copies new accounts here hasn't arrived yet.
                if (isPgError(error, PgErrorCode.foreignKeyViolation, 'favourites_user_id_users_id_fk')) {
                    throw conflict("Your account isn't ready yet. Try again in a minute.");
                }
                throw error;
            }
            return { saved: true };
        },

        async remove(caller, productId) {
            await db
                .delete(favourites)
                .where(and(eq(favourites.userId, caller.userId), eq(favourites.productId, productId)));
            return { saved: false };
        },
    };
}
