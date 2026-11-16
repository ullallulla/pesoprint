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

/**
 * Interim shipping prices per parcel, VAT included, until shipping is priced per zone (`shipping_rates`,
 * see the plan). The same for every address.
 */
export const INTERIM_SHIPPING_CENTS: Record<ParcelSize, number> = { S: 290, M: 490, L: 990 };

/** The parcel an order ships in: the largest of its prints' parcels. `null` when nothing ships. */
export function orderParcelSize(sizes: readonly ParcelSize[]): ParcelSize | null {
    if (sizes.length === 0) return null;
    return sizes.reduce((largest, size) =>
        PARCEL_SIZES.indexOf(size) > PARCEL_SIZES.indexOf(largest) ? size : largest,
    );
}

/** What shipping a parcel of this size costs. 0 when nothing ships. */
export function shippingCentsFor(parcelSize: ParcelSize | null): number {
    return parcelSize === null ? 0 : INTERIM_SHIPPING_CENTS[parcelSize];
}
