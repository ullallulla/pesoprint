/**
 * File storage, behind an interface so services don't depend on a provider and tests can use a fake.
 * Production uses the S3 API (Cloudflare R2), see `integrations/s3.ts`.
 */

/** `public`: images and 3D previews, served straight from the bucket. `private`: model downloads, only via signed URLs. */
export type Bucket = 'public' | 'private';

export interface PresignedUpload {
    url: string;
    /** Headers the browser must send with the PUT. They are signed, so the upload can't change them. */
    headers: Record<string, string>;
    expiresAt: Date;
}

export interface StoredObject {
    sizeBytes: number;
    contentType: string | undefined;
}

export interface Storage {
    /** A URL the browser can PUT exactly this file to (same type and size), valid for a few minutes. */
    presignUpload(input: {
        bucket: Bucket;
        key: string;
        contentType: string;
        sizeBytes: number;
    }): Promise<PresignedUpload>;
    /** Uploads from the server (seed script, generated files). Browser uploads use `presignUpload`. */
    put(bucket: Bucket, key: string, body: Uint8Array, contentType: string): Promise<void>;
    /** The object's contents, or `null` if it doesn't exist. Reads it all into memory: check the size first. */
    get(bucket: Bucket, key: string): Promise<Uint8Array | null>;
    /** The object's size and type, or `null` if it doesn't exist. */
    head(bucket: Bucket, key: string): Promise<StoredObject | null>;
    /** Deletes the objects. Keys that don't exist are ignored. */
    delete(bucket: Bucket, keys: string[]): Promise<void>;
    /** The public URL of an object in the public bucket. */
    publicUrl(key: string): string;
}

export interface StoredFileRef {
    bucket: Bucket;
    key: string;
}

/**
 * Deletes objects after their database rows are gone. A storage failure is logged, not thrown:
 * the rows are already deleted, so the worst case is an orphaned object, not a broken request.
 */
export async function deleteStoredFiles(storage: Storage | null, files: StoredFileRef[]): Promise<void> {
    if (!storage || files.length === 0) return;
    for (const bucket of ['public', 'private'] as const) {
        const keys = files.filter((file) => file.bucket === bucket).map((file) => file.key);
        if (keys.length === 0) continue;
        try {
            await storage.delete(bucket, keys);
        } catch (error) {
            console.error(`Could not delete ${keys.length} object(s) from the ${bucket} bucket:`, keys, error);
        }
    }
}
