import type { ParcelSize } from '@app/shared';

/** How the admin picks a model's parcel size. The longest-side limits match the seed's `parcelSizeFor()`. */
export const PARCEL_SIZE_LABELS: Record<ParcelSize, { name: string; hint: string }> = {
    S: { name: 'Small', hint: 'Fits a padded envelope or a small box: longest side up to about 12 cm.' },
    M: { name: 'Medium', hint: 'A shoebox-sized parcel: longest side up to about 25 cm.' },
    L: { name: 'Large', hint: 'Anything bigger.' },
};
