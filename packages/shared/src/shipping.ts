import { z } from 'zod';

/**
 * Parcel sizes, like the carriers' own size classes. Each model that can be printed has one; an order ships
 * in one parcel the size of its largest print, and shipping costs what `shipping_rates` says for that size
 * and the buyer's zone.
 */
// The database enum is built from this tuple, so changing it needs a migration.
export const PARCEL_SIZES = ['S', 'M', 'L'] as const;
export const parcelSizeSchema = z.enum(PARCEL_SIZES);
export type ParcelSize = z.infer<typeof parcelSizeSchema>;
