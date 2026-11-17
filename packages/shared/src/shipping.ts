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

/** For buyers: "Shipping (medium parcel)". */
export const PARCEL_SIZE_NAMES: Record<ParcelSize, string> = { S: 'small', M: 'medium', L: 'large' };

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

/**
 * Countries prints ship to. Stripe's payment page only accepts addresses in these (ISO 3166-1 alpha-2). More
 * come once carriers and rates are decided (see the plan).
 */
export const SHIPPING_COUNTRIES = ['FI'] as const;
export type ShippingCountry = (typeof SHIPPING_COUNTRIES)[number];

/** Where an order's prints go, as the buyer entered it on Stripe's payment page. */
export const shippingAddressSchema = z
    .object({
        name: z.string(),
        /** For the carrier's delivery notice. `null` if the buyer gave none. */
        phone: z.string().nullable(),
        line1: z.string(),
        line2: z.string().nullable(),
        postalCode: z.string(),
        city: z.string(),
        /** ISO 3166-1 alpha-2, e.g. `FI`. */
        country: z.string().length(2),
    })
    .meta({ id: 'ShippingAddress' });
export type ShippingAddress = z.infer<typeof shippingAddressSchema>;
