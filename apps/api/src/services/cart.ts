import {
    isPaidFile,
    ORDER_CURRENCY,
    SHOP_VAT_COUNTRY,
    SHOP_VAT_RATE_BP,
    vatIncludedCents,
    type CartItem,
    type CartLine,
    type CartQuote,
} from '@app/shared';
import { and, eq, inArray } from 'drizzle-orm';

import type { Database } from '../db/client.ts';
import { entitlements, products } from '../db/schema.ts';
import type { AuthContext } from '../lib/auth.ts';
import type { Storage } from '../lib/storage.ts';
import { catalogImage, coverImages } from './catalog.ts';

export interface CartService {
    /**
     * Prices the cart from the database: what can be bought, at today's prices, and the VAT. Items that
     * can't be bought are listed separately with the reason. A signed-in caller's purchases count as owned.
     */
    quote(items: CartItem[], caller: AuthContext | undefined): Promise<CartQuote>;
}

const itemKey = (item: CartItem) => `${item.type}:${item.productId}`;

export function createCartService(db: Database, storage: Storage | null): CartService {
    async function ownedProductIds(userId: string, productIds: string[]): Promise<Set<string>> {
        const rows = await db
            .select({ productId: entitlements.productId })
            .from(entitlements)
            .where(and(eq(entitlements.userId, userId), inArray(entitlements.productId, productIds)));
        return new Set(rows.map((row) => row.productId));
    }

    return {
        async quote(items, caller) {
            const unique = [...new Map(items.map((item) => [itemKey(item), item])).values()];
            const productIds = [...new Set(unique.map((item) => item.productId))];

            const [rows, owned, covers] =
                productIds.length === 0
                    ? [[], new Set<string>(), new Map()]
                    : await Promise.all([
                          db
                              .select({
                                  id: products.id,
                                  slug: products.slug,
                                  title: products.title,
                                  status: products.status,
                                  digitalPriceCents: products.digitalPriceCents,
                                  license: products.license,
                              })
                              .from(products)
                              .where(inArray(products.id, productIds)),
                          caller ? ownedProductIds(caller.userId, productIds) : new Set<string>(),
                          coverImages(db, productIds),
                      ]);
            const byId = new Map(rows.map((row) => [row.id, row]));

            const lines: CartLine[] = [];
            const removed: CartQuote['removed'] = [];
            for (const item of unique) {
                const product = byId.get(item.productId);
                // Only digital items exist so far: on sale means published with a paid file.
                if (!product || product.status !== 'published' || !isPaidFile(product) || !product.license) {
                    removed.push({
                        ...item,
                        // A draft's title isn't public, even to someone who has its id.
                        title: product && product.status !== 'draft' ? product.title : null,
                        reason: 'unavailable',
                    });
                } else if (owned.has(product.id)) {
                    removed.push({ ...item, title: product.title, reason: 'owned' });
                } else {
                    const cover = covers.get(product.id);
                    lines.push({
                        ...item,
                        slug: product.slug,
                        title: product.title,
                        cover: cover ? catalogImage(storage, cover) : null,
                        license: product.license,
                        unitPriceCents: product.digitalPriceCents!,
                        // A file is bought once; buying it twice gives nothing more.
                        quantity: 1,
                    });
                }
            }

            const subtotalCents = lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
            const totalCents = subtotalCents;
            return {
                lines,
                removed,
                currency: ORDER_CURRENCY,
                subtotalCents,
                totalCents,
                taxCents: vatIncludedCents(totalCents, SHOP_VAT_RATE_BP),
                vatCountry: SHOP_VAT_COUNTRY,
                vatRateBp: SHOP_VAT_RATE_BP,
            };
        },
    };
}
