import type { Database } from '../db/client.ts';
import { productFiles, productImages } from '../db/schema.ts';
import type { Bucket, ListedObject, Storage } from './storage.ts';

/**
 * Where the app stores its files: uploads under `products/`, the seed's files under `seed/`. Anything
 * else in the buckets was put there by hand and is never touched.
 */
export const MANAGED_PREFIXES = ['products/', 'seed/'] as const;

/**
 * Files younger than this are left alone even if nothing uses them yet: an upload is stored first and
 * attached to its product a moment later, and that must not be mistaken for an orphan.
 */
export const ORPHAN_MIN_AGE_HOURS = 24;

export interface StoredObjectRef extends ListedObject {
    bucket: Bucket;
}

export interface StorageCleanupReport {
    /** Files no product uses, old enough to delete. */
    orphans: StoredObjectRef[];
    /** Files no product uses yet, but too new to delete (uploads in progress). */
    recent: number;
    /** Files the database points to that aren't in storage: broken images or downloads. */
    missing: { bucket: Bucket; key: string }[];
    /** How many files the database points to in total. */
    referenced: number;
}

/** The database and the buckets belong to different environments (e.g. staging database, dev buckets). */
export class StorageMismatchError extends Error {}

const BUCKETS: Bucket[] = ['public', 'private'];
const refId = (bucket: Bucket, key: string) => `${bucket}:${key}`;

/** Every file the database points to: product images, previews (public) and downloads (private). */
async function referencedKeys(db: Database): Promise<Map<string, { bucket: Bucket; key: string }>> {
    const [images, files] = await Promise.all([
        db.select({ key: productImages.storageKey }).from(productImages),
        db.select({ key: productFiles.storageKey, kind: productFiles.kind }).from(productFiles),
    ]);
    const refs = [
        ...images.map(({ key }) => ({ bucket: 'public' as const, key })),
        ...files.map(({ key, kind }) => ({
            bucket: kind === 'download' ? ('private' as const) : ('public' as const),
            key,
        })),
    ];
    return new Map(refs.map((ref) => [refId(ref.bucket, ref.key), ref]));
}

/**
 * Finds files in storage that no product uses: uploads that were never attached, and files whose
 * deletion failed after their product, image or file was removed. Deletes nothing.
 */
export async function findOrphans(
    db: Database,
    storage: Storage,
    { now = new Date() }: { now?: Date } = {},
): Promise<StorageCleanupReport> {
    // List storage before reading the database: a file attached in between is then never reported.
    const listed: StoredObjectRef[] = [];
    for (const bucket of BUCKETS) {
        for (const prefix of MANAGED_PREFIXES) {
            for (const object of await storage.list(bucket, prefix)) {
                listed.push({ bucket, ...object });
            }
        }
    }
    const referenced = await referencedKeys(db);

    const stored = new Set(listed.map((object) => refId(object.bucket, object.key)));
    const missing = [...referenced.entries()].filter(([id]) => !stored.has(id)).map(([, ref]) => ref);
    if (referenced.size > 0 && missing.length === referenced.size) {
        throw new StorageMismatchError(
            `None of the ${referenced.size} files the database points to are in storage, so the database and the ` +
                'buckets look like they belong to different environments. Nothing was checked or deleted.',
        );
    }

    const cutoff = now.getTime() - ORPHAN_MIN_AGE_HOURS * 60 * 60 * 1000;
    const unused = listed.filter((object) => !referenced.has(refId(object.bucket, object.key)));
    const orphans = unused
        .filter((object) => object.lastModified.getTime() < cutoff)
        .toSorted((a, b) => refId(a.bucket, a.key).localeCompare(refId(b.bucket, b.key)));

    return { orphans, recent: unused.length - orphans.length, missing, referenced: referenced.size };
}

/** Deletes the orphans {@link findOrphans} found. */
export async function deleteOrphans(storage: Storage, orphans: StoredObjectRef[]): Promise<void> {
    for (const bucket of BUCKETS) {
        const keys = orphans.filter((object) => object.bucket === bucket).map((object) => object.key);
        if (keys.length > 0) await storage.delete(bucket, keys);
    }
}
