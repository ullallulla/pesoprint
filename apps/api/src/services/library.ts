import type { LibraryItem } from '@app/shared';
import { and, asc, desc, eq, inArray, ne, type SQL } from 'drizzle-orm';

import type { Database } from '../db/client.ts';
import { entitlements, productFiles, products } from '../db/schema.ts';
import type { AuthContext } from '../lib/auth.ts';
import { notFound } from '../lib/errors.ts';
import type { Storage } from '../lib/storage.ts';
import { catalogImage, coverImages } from './catalog.ts';

/** What a user owns: the "My library" page, and "In your library" on a product page. */
export interface LibraryService {
    /** Everything the caller owns, most recently acquired first. */
    list(caller: AuthContext): Promise<LibraryItem[]>;
    /** One model the caller owns. 404 if they don't own it. */
    item(caller: AuthContext, productId: string): Promise<LibraryItem>;
}

export function createLibraryService(db: Database, storage: Storage | null): LibraryService {
    async function load(caller: AuthContext, where?: SQL): Promise<LibraryItem[]> {
        const rows = await db
            .select({
                productId: products.id,
                slug: products.slug,
                title: products.title,
                status: products.status,
                orderId: entitlements.orderId,
                grantedAt: entitlements.grantedAt,
            })
            .from(entitlements)
            .innerJoin(products, eq(products.id, entitlements.productId))
            // Buyers can download published and archived models (see canDownload), so a draft isn't listed.
            .where(and(eq(entitlements.userId, caller.userId), ne(products.status, 'draft'), where))
            .orderBy(desc(entitlements.grantedAt), asc(products.title));
        if (rows.length === 0) return [];

        const productIds = rows.map((row) => row.productId);
        const [files, covers] = await Promise.all([
            db
                .select()
                .from(productFiles)
                .where(and(inArray(productFiles.productId, productIds), eq(productFiles.kind, 'download')))
                .orderBy(asc(productFiles.position), asc(productFiles.id)),
            coverImages(db, productIds),
        ]);

        return rows.map((row) => {
            const cover = covers.get(row.productId);
            return {
                productId: row.productId,
                slug: row.slug,
                title: row.title,
                cover: cover ? catalogImage(storage, cover) : null,
                listed: row.status === 'published',
                orderId: row.orderId,
                acquiredAt: row.grantedAt.toISOString(),
                files: files
                    .filter((file) => file.productId === row.productId)
                    .map((file) => ({
                        id: file.id,
                        format: file.format,
                        filename: file.filename,
                        sizeBytes: file.sizeBytes,
                    })),
            };
        });
    }

    return {
        list: (caller) => load(caller),

        async item(caller, productId) {
            const [item] = await load(caller, eq(products.id, productId));
            if (!item) throw notFound("You don't own this model.");
            return item;
        },
    };
}
