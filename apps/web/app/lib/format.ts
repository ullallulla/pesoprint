import { isFreeDownload, isPaidFile, offersPrint, type ProductOffers } from '@app/shared';

const euro = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' });

/** `450` → `€4.50`. Prices are integer euro cents including VAT. */
export function formatPrice(cents: number): string {
    return euro.format(cents / 100);
}

export interface OfferLine {
    kind: 'free' | 'file' | 'print';
    label: string;
}

/** The ways a product is offered, as short labels for cards and the product page. */
export function offerLines(product: ProductOffers): OfferLine[] {
    const lines: OfferLine[] = [];
    if (isFreeDownload(product)) lines.push({ kind: 'free', label: 'Free download' });
    if (isPaidFile(product)) lines.push({ kind: 'file', label: `File ${formatPrice(product.digitalPriceCents!)}` });
    if (offersPrint(product))
        lines.push({ kind: 'print', label: `Print from ${formatPrice(product.printBasePriceCents!)}` });
    return lines;
}

/** `5_000_000` → `4.8 MB`. */
export function formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

/**
 * Plain text from markdown, cut at a word boundary: for meta descriptions and previews.
 * Strips the common syntax (headings, emphasis, links, lists, code); it doesn't need to be a full parser.
 */
export function plainExcerpt(markdown: string, maxLength = 160): string {
    const text = markdown
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/^\s{0,3}(#{1,6}|[-*+]|\d+\.|>)\s+/gm, '')
        .replace(/[*_`~]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (text.length <= maxLength) return text;
    const cut = text.slice(0, maxLength - 1);
    const lastSpace = cut.lastIndexOf(' ');
    return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,.;:]+$/, '')}…`;
}
