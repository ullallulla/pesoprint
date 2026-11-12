import { isFreeDownload, MODEL_CONTENT_TYPES, type DownloadLink } from '@app/shared';
import { eq, sql } from 'drizzle-orm';

import type { Database } from '../db/client.ts';
import { downloadEvents, productFiles, products, users, type Product } from '../db/schema.ts';
import type { AuthContext } from '../lib/auth.ts';
import type { IpHasher } from '../lib/client-ip.ts';
import { AppError, notFound } from '../lib/errors.ts';
import type { Storage } from '../lib/storage.ts';

/** How long a download link works. Long enough to start a slow download, short enough not to be worth sharing. */
export const DOWNLOAD_LINK_SECONDS = 5 * 60;

export interface DownloadsService {
    /** Checks access, logs the download and returns a short-lived link to the file. 404 if not allowed. */
    start(input: { fileId: string; caller: AuthContext | undefined; ip: string | null }): Promise<DownloadLink>;
}

/** Admins and the model's creator: they can download anything, and their downloads aren't counted. */
function isStaff(product: Pick<Product, 'creatorId'>, caller: AuthContext | undefined): boolean {
    return caller !== undefined && (caller.role === 'admin' || caller.userId === product.creatorId);
}

/**
 * The one rule for who may download a product's files:
 * - admins and the model's creator: always (drafts and archived models too);
 * - anyone, without an account: free models that are published;
 * - paid files: only buyers, which arrives with checkout (M3). Until then, nobody else.
 */
export function canDownload(
    product: Pick<Product, 'status' | 'digitalPriceCents' | 'creatorId'>,
    caller: AuthContext | undefined,
): boolean {
    if (isStaff(product, caller)) return true;
    return product.status === 'published' && isFreeDownload(product);
}

export function createDownloadsService(
    db: Database,
    storage: Storage | null,
    hashIp: IpHasher,
    now: () => Date = () => new Date(),
): DownloadsService {
    return {
        async start({ fileId, caller, ip }) {
            const [row] = await db
                .select({ file: productFiles, product: products })
                .from(productFiles)
                .innerJoin(products, eq(products.id, productFiles.productId))
                .where(eq(productFiles.id, fileId));

            // Previews are public anyway, and everything else that isn't allowed is "not found":
            // a 403 would confirm that a draft or a paid file exists.
            if (!row || row.file.kind !== 'download' || !canDownload(row.product, caller)) {
                throw notFound('File not found.');
            }
            if (!storage) {
                throw new AppError(503, 'internal_error', 'File storage is not configured on this server.');
            }
            const { file, product } = row;
            const at = now();

            await db.transaction(async (tx) => {
                await tx.insert(downloadEvents).values({
                    productId: product.id,
                    fileId: file.id,
                    // Only if the account has been synced from Clerk; otherwise the download is logged anonymously.
                    userId: caller
                        ? sql`(SELECT ${users.id} FROM ${users} WHERE ${users.id} = ${caller.userId})`
                        : null,
                    ipHash: hashIp(ip, at),
                    createdAt: at,
                });
                if (!isStaff(product, caller)) {
                    await tx
                        .update(products)
                        // Keep updated_at: a download isn't an edit (it would reorder the admin list and the sitemap).
                        .set({
                            downloadCount: sql`${products.downloadCount} + 1`,
                            updatedAt: sql`${products.updatedAt}`,
                        })
                        .where(eq(products.id, product.id));
                }
            });

            const url = await storage.presignDownload({
                bucket: 'private',
                key: file.storageKey,
                filename: file.filename,
                contentType: MODEL_CONTENT_TYPES[file.format],
                expiresInSeconds: DOWNLOAD_LINK_SECONDS,
            });
            return {
                url,
                filename: file.filename,
                expiresAt: new Date(at.getTime() + DOWNLOAD_LINK_SECONDS * 1000).toISOString(),
            };
        },
    };
}
