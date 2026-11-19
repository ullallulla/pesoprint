import { z } from 'zod';

import { catalogProductCardSchema } from './catalog.ts';

/** Whether the caller saved a model with the heart button. */
export const favouriteStatusSchema = z.object({ saved: z.boolean() }).meta({ id: 'FavouriteStatus' });
export type FavouriteStatus = z.infer<typeof favouriteStatusSchema>;

export const favouriteSchema = z
    .object({
        /** What the heart button sends to remove it. */
        productId: z.uuid(),
        savedAt: z.iso.datetime(),
        product: catalogProductCardSchema,
    })
    .meta({ id: 'Favourite' });
export type Favourite = z.infer<typeof favouriteSchema>;

/** The caller's saved models that are for sale, most recently saved first. */
export const favouriteListSchema = z.object({ items: z.array(favouriteSchema) }).meta({ id: 'FavouriteList' });
export type FavouriteList = z.infer<typeof favouriteListSchema>;

/** How many models one account can save: plenty for a person, and it keeps the page one page long. */
export const MAX_FAVOURITES = 200;
