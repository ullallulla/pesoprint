/**
 * VAT. Catalogue prices include VAT, so the VAT on an order is backed out of its total rather than added
 * on top: the buyer pays the price they saw.
 *
 * Until the shop is VAT-registered and sells across borders (M6, plan §9), every order uses the Finnish
 * standard rate. Rates are basis points: 2550 = 25.5 %.
 */
export const SHOP_VAT_COUNTRY = 'FI';
export const SHOP_VAT_RATE_BP = 2550;

/**
 * The VAT contained in a VAT-inclusive amount, in whole cents: the amount minus its net, with the net
 * rounded to the nearest cent. €4.50 at 25.5 % → net €3.59 (358.57 rounded), VAT €0.91.
 *
 * Call it once on an order's total, not per line and summed: rounding each line separately can make the
 * VAT a cent or two off from the total's.
 */
export function vatIncludedCents(grossCents: number, rateBp: number): number {
    if (!Number.isInteger(grossCents) || grossCents < 0) {
        throw new RangeError(`grossCents must be a non-negative integer, got ${grossCents}`);
    }
    if (!Number.isInteger(rateBp) || rateBp < 0 || rateBp >= 10_000) {
        throw new RangeError(`rateBp must be an integer from 0 to 9999, got ${rateBp}`);
    }
    const netCents = Math.round((grossCents * 10_000) / (10_000 + rateBp));
    return grossCents - netCents;
}

/** `2550` → `"25.5 %"`. */
export function formatVatRate(rateBp: number): string {
    return `${(rateBp / 100).toLocaleString('en-IE', { maximumFractionDigits: 2 })} %`;
}
