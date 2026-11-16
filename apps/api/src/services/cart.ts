import {
    cartItemKey,
    isPaidFile,
    MAX_PRINT_QUANTITY,
    ORDER_CURRENCY,
    orderParcelSize,
    SHOP_VAT_COUNTRY,
    SHOP_VAT_RATE_BP,
    shippingCentsFor,
    vatIncludedCents,
    type CartItem,
    type CartLine,
    type CartQuote,
    type CatalogColourOption,
    type ParcelSize,
    type PrintCartItem,
} from '@app/shared';
import { and, eq, inArray } from 'drizzle-orm';

import type { Database } from '../db/client.ts';
import { entitlements, materials, productMaterials, products } from '../db/schema.ts';
import type { AuthContext } from '../lib/auth.ts';
import type { Storage } from '../lib/storage.ts';
import { catalogImage, colourOptionsFor, coverImages } from './catalog.ts';

export interface CartService {
    /**
     * Prices the cart from the database: what can be bought, at today's prices, the shipping, and the VAT.
     * Items that can't be bought are listed separately with the reason. A signed-in caller's purchases count
     * as owned.
     */
    quote(items: CartItem[], caller: AuthContext | undefined): Promise<CartQuote>;
}

/**
 * The same item twice is one line: a file once, a print with its quantities added up (to the most allowed).
 * Lines keep the order they were first added in.
 */
function mergeItems(items: CartItem[]): CartItem[] {
    const merged = new Map<string, CartItem>();
    for (const item of items) {
        const key = cartItemKey(item);
        const earlier = merged.get(key);
        if (earlier?.type === 'print' && item.type === 'print') {
            merged.set(key, { ...earlier, quantity: Math.min(earlier.quantity + item.quantity, MAX_PRINT_QUANTITY) });
        } else if (!earlier) {
            merged.set(key, item);
        }
    }
    return [...merged.values()];
}

export function createCartService(db: Database, storage: Storage | null): CartService {
    async function ownedProductIds(userId: string, productIds: string[]): Promise<Set<string>> {
        const rows = await db
            .select({ productId: entitlements.productId })
            .from(entitlements)
            .where(and(eq(entitlements.userId, userId), inArray(entitlements.productId, productIds)));
        return new Set(rows.map((row) => row.productId));
    }

    /** The materials asked for (by id), and the price of each product in each material it's printed in. */
    async function printMaterials(items: PrintCartItem[]): Promise<{
        materialsById: Map<string, { id: string; name: string; active: boolean }>;
        priceOf: (productId: string, materialId: string) => number | null;
    }> {
        if (items.length === 0) return { materialsById: new Map(), priceOf: () => null };
        const [materialRows, prices] = await Promise.all([
            db
                .select({ id: materials.id, name: materials.name, active: materials.active })
                .from(materials)
                .where(
                    inArray(
                        materials.id,
                        items.map((item) => item.materialId),
                    ),
                ),
            db
                .select()
                .from(productMaterials)
                .where(
                    inArray(
                        productMaterials.productId,
                        items.map((item) => item.productId),
                    ),
                ),
        ]);
        return {
            materialsById: new Map(materialRows.map((row) => [row.id, row])),
            priceOf: (productId: string, materialId: string): number | null =>
                prices.find((row) => row.productId === productId && row.materialId === materialId)?.priceCents ?? null,
        };
    }

    return {
        async quote(items, caller) {
            const unique = mergeItems(items);
            const productIds = [...new Set(unique.map((item) => item.productId))];
            const prints = unique.filter((item): item is PrintCartItem => item.type === 'print');

            const printProductIds = [...new Set(prints.map((item) => item.productId))];
            const [rows, owned, covers, { materialsById, priceOf }, colourOptions] =
                productIds.length === 0
                    ? [
                          [],
                          new Set<string>(),
                          new Map(),
                          await printMaterials([]),
                          new Map<string, CatalogColourOption[]>(),
                      ]
                    : await Promise.all([
                          db
                              .select({
                                  id: products.id,
                                  slug: products.slug,
                                  title: products.title,
                                  status: products.status,
                                  digitalPriceCents: products.digitalPriceCents,
                                  printBasePriceCents: products.printBasePriceCents,
                                  parcelSize: products.parcelSize,
                                  license: products.license,
                              })
                              .from(products)
                              .where(inArray(products.id, productIds)),
                          caller ? ownedProductIds(caller.userId, productIds) : new Set<string>(),
                          coverImages(db, productIds),
                          printMaterials(prints),
                          colourOptionsFor(db, printProductIds),
                      ]);
            const byId = new Map(rows.map((row) => [row.id, row]));

            const lines: CartLine[] = [];
            const parcels: ParcelSize[] = [];
            const removed: CartQuote['removed'] = [];
            for (const item of unique) {
                const product = byId.get(item.productId);
                const materialId = item.type === 'print' ? item.materialId : null;
                const colourOptionId = item.type === 'print' ? item.colourOptionId : null;
                // A draft's title isn't public, even to someone who has its id.
                const title = product && product.status !== 'draft' ? product.title : null;
                const remove = (reason: CartQuote['removed'][number]['reason'], option: string | null = null) =>
                    removed.push({
                        productId: item.productId,
                        type: item.type,
                        materialId,
                        colourOptionId,
                        title,
                        option,
                        reason,
                    });
                const line = (forSale: { id: string; slug: string; title: string }) => {
                    const cover = covers.get(forSale.id);
                    return {
                        productId: forSale.id,
                        type: item.type,
                        materialId,
                        colourOptionId,
                        slug: forSale.slug,
                        title: forSale.title,
                        cover: cover ? catalogImage(storage, cover) : null,
                    };
                };

                if (!product || product.status !== 'published') {
                    remove('unavailable');
                } else if (item.type === 'digital') {
                    if (!isPaidFile(product) || !product.license) {
                        remove('unavailable');
                    } else if (owned.has(product.id)) {
                        remove('owned');
                    } else {
                        lines.push({
                            ...line(product),
                            license: product.license,
                            print: null,
                            unitPriceCents: product.digitalPriceCents!,
                            // A file is bought once; buying it twice gives nothing more.
                            quantity: 1,
                        });
                    }
                } else {
                    const material = materialsById.get(item.materialId);
                    const priceCents = priceOf(product.id, item.materialId);
                    const options = colourOptions.get(product.id) ?? [];
                    const colour =
                        item.colourOptionId === null
                            ? null
                            : options.find((option) => option.id === item.colourOptionId);
                    // A model with colour options needs one of them, in stock in the chosen material; a model
                    // without any is printed as shown.
                    const colourOk =
                        item.colourOptionId === null
                            ? options.length === 0
                            : colour?.materials.find((entry) => entry.materialId === item.materialId)?.inStock === true;
                    if (product.printBasePriceCents === null || !product.parcelSize) {
                        remove('unavailable');
                    } else if (!material?.active || priceCents === null || !colourOk) {
                        const option = [material?.name, colour?.name].filter(Boolean).join(', ');
                        remove('option_unavailable', option || null);
                    } else {
                        parcels.push(product.parcelSize);
                        lines.push({
                            ...line(product),
                            license: null,
                            print: {
                                materialName: material.name,
                                colourName: colour?.name ?? null,
                                colours: colour?.colours ?? [],
                            },
                            unitPriceCents: priceCents,
                            quantity: item.quantity,
                        });
                    }
                }
            }

            const subtotalCents = lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
            const parcelSize = orderParcelSize(parcels);
            const shippingCents = shippingCentsFor(parcelSize);
            const totalCents = subtotalCents + shippingCents;
            return {
                lines,
                removed,
                currency: ORDER_CURRENCY,
                subtotalCents,
                parcelSize,
                shippingCents,
                totalCents,
                // Shipping is taxed at the rate of what it delivers: one rate for now.
                taxCents: vatIncludedCents(totalCents, SHOP_VAT_RATE_BP),
                vatCountry: SHOP_VAT_COUNTRY,
                vatRateBp: SHOP_VAT_RATE_BP,
            };
        },
    };
}
