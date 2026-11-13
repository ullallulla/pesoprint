import { isFreeDownload, MODEL_CONTENT_TYPES, type DownloadLink } from '@app/shared';
import { and, count, eq, gt, isNotNull, lt, min, sql } from 'drizzle-orm';

import type { Database } from '../db/client.ts';
import { downloadEvents, productFiles, products, users, type Product } from '../db/schema.ts';
import type { AuthContext } from '../lib/auth.ts';
import type { IpHasher } from '../lib/client-ip.ts';
import { AppError, notFound, RateLimitedError } from '../lib/errors.ts';
import type { Storage } from '../lib/storage.ts';

/** How long a download link works. Long enough to start a slow download, short enough not to be worth sharing. */
export const DOWNLOAD_LINK_SECONDS = 5 * 60;

export interface DownloadLimit {
    /** Downloads allowed per visitor (anonymised IP) within the window. */
    count: number;
    windowSeconds: number;
}

/**
 * Generous for a person (a model with several parts, a few models in a row), but it stops scripts from
 * copying the whole catalogue or running up storage costs. Admins and the creator aren't limited.
 */
export const DOWNLOAD_LIMIT: DownloadLimit = { count: 30, windowSeconds: 60 * 60 };

/**
 * How long a download keeps its IP hash. The rate limit only looks back an hour; the rest is a short
 * margin for looking into abuse. The privacy policy promises this, so keep them in step.
 */
export const IP_HASH_RETENTION_DAYS = 7;

export interface DownloadsService {
    /** Checks access, logs the download and returns a short-lived link to the file. 404 if not allowed. */
    start(input: { fileId: string; caller: AuthContext | undefined; ip: string | null }): Promise<DownloadLink>;
    /** Erases the IP hash from downloads older than the retention period. Returns how many were erased. */
    forgetOldIpHashes(): Promise<number>;
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
    { now = () => new Date(), limit = DOWNLOAD_LIMIT }: { now?: () => Date; limit?: DownloadLimit } = {},
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
            const ipHash = hashIp(ip, at);
            const staff = isStaff(product, caller);

            await db.transaction(async (tx) => {
                // Visitors with a known IP are limited. Without one (e.g. locally) there's nothing to count by.
                if (!staff && ipHash !== null) {
                    // Concurrent downloads from one visitor wait here, so they can't all pass the count at once.
                    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${ipHash}, 0))`);
                    const since = new Date(at.getTime() - limit.windowSeconds * 1000);
                    const [recent] = await tx
                        .select({ total: count(), oldest: min(downloadEvents.createdAt) })
                        .from(downloadEvents)
                        .where(and(eq(downloadEvents.ipHash, ipHash), gt(downloadEvents.createdAt, since)));
                    if (recent && recent.total >= limit.count && recent.oldest) {
                        // Free again when the oldest download in the window drops out of it.
                        const freeAt = recent.oldest.getTime() + limit.windowSeconds * 1000;
                        const retryAfter = Math.max(1, Math.ceil((freeAt - at.getTime()) / 1000));
                        const minutes = Math.ceil(retryAfter / 60);
                        throw new RateLimitedError(
                            `You've reached the limit of ${limit.count} downloads an hour. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`,
                            retryAfter,
                        );
                    }
                }

                await tx.insert(downloadEvents).values({
                    productId: product.id,
                    fileId: file.id,
                    // Only if the account has been synced from Clerk; otherwise the download is logged anonymously.
                    userId: caller
                        ? sql`(SELECT ${users.id} FROM ${users} WHERE ${users.id} = ${caller.userId})`
                        : null,
                    ipHash,
                    createdAt: at,
                });
                if (!staff) {
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

        async forgetOldIpHashes() {
            const before = new Date(now().getTime() - IP_HASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
            const erased = await db
                .update(downloadEvents)
                .set({ ipHash: null })
                .where(and(isNotNull(downloadEvents.ipHash), lt(downloadEvents.createdAt, before)))
                .returning({ id: downloadEvents.id });
            return erased.length;
        },
    };
}
