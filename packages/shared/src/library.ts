import { z } from 'zod';

import { catalogImageSchema } from './catalog.ts';
import { orderFileSchema } from './checkout.ts';

/** A model the user owns (bought, or was given), with its files to download. */
export const libraryItemSchema = z
    .object({
        productId: z.uuid(),
        /** For the product page and download links. */
        slug: z.string(),
        /** The model's current title. */
        title: z.string(),
        cover: catalogImageSchema.nullable(),
        /** `false` once the model is archived: it has no public page any more, but its files stay downloadable here. */
        listed: z.boolean(),
        /** The order it was bought in. `null` if it was given without an order, or the order was deleted. */
        orderId: z.uuid().nullable(),
        acquiredAt: z.iso.datetime(),
        files: z.array(orderFileSchema),
    })
    .meta({ id: 'LibraryItem' });
export type LibraryItem = z.infer<typeof libraryItemSchema>;

/** Everything the user owns, most recently acquired first. */
export const librarySchema = z.object({ items: z.array(libraryItemSchema) }).meta({ id: 'Library' });
export type Library = z.infer<typeof librarySchema>;
