import { z } from 'zod';

/**
 * Catalogue prices are integer euro cents, including VAT.
 *
 * `digitalPriceCents`: `null` = no file offered, `0` = free download, `> 0` = paid file.
 * `printBasePriceCents`: `null` = not offered as a print, otherwise > 0.
 *
 * Always use the helpers below instead of testing the prices for truthiness:
 * `!product.digitalPriceCents` is true both for a free download and for "no file at all".
 */
export interface ProductOffers {
    digitalPriceCents: number | null;
    printBasePriceCents: number | null;
}

/** Upper bound for any single catalogue price (€10,000), to catch typos like an extra zero or two. */
export const MAX_PRICE_CENTS = 1_000_000;

export const digitalPriceCentsSchema = z.int().min(0).max(MAX_PRICE_CENTS).nullable();
export const printBasePriceCentsSchema = z.int().min(1).max(MAX_PRICE_CENTS).nullable();

/** The model's file can be downloaded, either free or paid. */
export function offersFile(product: Pick<ProductOffers, 'digitalPriceCents'>): boolean {
    return product.digitalPriceCents !== null;
}

/** Anyone may download the file, no account needed. */
export function isFreeDownload(product: Pick<ProductOffers, 'digitalPriceCents'>): boolean {
    return product.digitalPriceCents === 0;
}

/** The file must be bought before it can be downloaded. */
export function isPaidFile(product: Pick<ProductOffers, 'digitalPriceCents'>): boolean {
    return product.digitalPriceCents !== null && product.digitalPriceCents > 0;
}

/**
 * Whether the public product page has a 3D view. Anything the browser shows can be saved and printed,
 * so only free downloads get one: for a paid file or a print-only model it would give the model away.
 */
export function hasPublicPreview(product: Pick<ProductOffers, 'digitalPriceCents'>): boolean {
    return isFreeDownload(product);
}

/** The model can be ordered as a physical print. */
export function offersPrint(product: Pick<ProductOffers, 'printBasePriceCents'>): boolean {
    return product.printBasePriceCents !== null;
}
