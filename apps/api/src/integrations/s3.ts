import {
    DeleteObjectsCommand,
    GetObjectCommand,
    HeadObjectCommand,
    ListObjectsV2Command,
    NoSuchKey,
    NotFound,
    PutObjectCommand,
    S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type { Env } from '../env.ts';
import { attachmentDisposition, type Bucket, type ListedObject, type Storage } from '../lib/storage.ts';

export interface S3StorageConfig {
    /** e.g. `https://<account id>.r2.cloudflarestorage.com` for R2. */
    endpoint: string;
    /** `auto` for R2. */
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    buckets: Record<Bucket, string>;
    /** Base URL the public bucket is served from (custom domain or r2.dev URL). */
    publicBaseUrl: string;
    /** How long a presigned upload URL stays valid. */
    uploadUrlTtlSeconds?: number;
}

const isNotFound = (error: unknown) =>
    (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404;

/** Storage on any S3-compatible service: Cloudflare R2, AWS S3, MinIO. */
export function createS3Storage(config: S3StorageConfig): Storage {
    const client = new S3Client({
        endpoint: config.endpoint,
        region: config.region,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
        // Bucket in the path, not the host name: works the same on R2, S3 and MinIO.
        forcePathStyle: true,
        // Newer AWS SDKs add CRC checksums to every request by default. A presigned browser upload
        // can't compute them, and R2 doesn't support them all, so only send them when an API requires it.
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
    });
    const ttl = config.uploadUrlTtlSeconds ?? 15 * 60;
    const publicBaseUrl = config.publicBaseUrl.replace(/\/+$/, '');

    return {
        async presignUpload({ bucket, key, contentType, sizeBytes }) {
            const command = new PutObjectCommand({
                Bucket: config.buckets[bucket],
                Key: key,
                ContentType: contentType,
                ContentLength: sizeBytes,
            });
            const url = await getSignedUrl(client, command, {
                expiresIn: ttl,
                // Sign the type and length too, so the URL only accepts the file that was announced.
                signableHeaders: new Set(['content-type', 'content-length']),
            });
            // The browser sets Content-Length itself from the file; Content-Type must be sent as given.
            return { url, headers: { 'content-type': contentType }, expiresAt: new Date(Date.now() + ttl * 1000) };
        },

        async presignDownload({ bucket, key, filename, contentType, expiresInSeconds }) {
            const command = new GetObjectCommand({
                Bucket: config.buckets[bucket],
                Key: key,
                // Override the stored headers in the response, so the file is saved under its original name.
                ResponseContentDisposition: attachmentDisposition(filename),
                ResponseContentType: contentType,
            });
            return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
        },

        async put(bucket, key, body, contentType) {
            await client.send(
                new PutObjectCommand({
                    Bucket: config.buckets[bucket],
                    Key: key,
                    Body: body,
                    ContentType: contentType,
                }),
            );
        },

        async get(bucket, key) {
            try {
                const result = await client.send(new GetObjectCommand({ Bucket: config.buckets[bucket], Key: key }));
                return result.Body ? await result.Body.transformToByteArray() : new Uint8Array();
            } catch (error) {
                if (error instanceof NoSuchKey || isNotFound(error)) return null;
                throw error;
            }
        },

        async head(bucket, key) {
            try {
                const result = await client.send(new HeadObjectCommand({ Bucket: config.buckets[bucket], Key: key }));
                return { sizeBytes: result.ContentLength ?? 0, contentType: result.ContentType };
            } catch (error) {
                if (error instanceof NotFound || isNotFound(error)) return null;
                throw error;
            }
        },

        async list(bucket, prefix) {
            const objects: ListedObject[] = [];
            let token: string | undefined;
            // Up to 1000 keys per page.
            do {
                const page = await client.send(
                    new ListObjectsV2Command({
                        Bucket: config.buckets[bucket],
                        Prefix: prefix,
                        ContinuationToken: token,
                    }),
                );
                for (const object of page.Contents ?? []) {
                    if (object.Key && object.LastModified) {
                        objects.push({
                            key: object.Key,
                            sizeBytes: object.Size ?? 0,
                            lastModified: object.LastModified,
                        });
                    }
                }
                token = page.IsTruncated ? page.NextContinuationToken : undefined;
            } while (token);
            return objects;
        },

        async delete(bucket, keys) {
            // DeleteObjects takes at most 1000 keys per request.
            for (let start = 0; start < keys.length; start += 1000) {
                const batch = keys.slice(start, start + 1000);
                await client.send(
                    new DeleteObjectsCommand({
                        Bucket: config.buckets[bucket],
                        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
                    }),
                );
            }
        },

        publicUrl(key) {
            return `${publicBaseUrl}/${key.split('/').map(encodeURIComponent).join('/')}`;
        },
    };
}

/** Storage from the validated environment, or `null` when the `S3_*` settings aren't set (env.ts makes them all-or-none). */
export function createStorageFromEnv(env: Env): Storage | null {
    const {
        S3_ENDPOINT,
        S3_ACCESS_KEY_ID,
        S3_SECRET_ACCESS_KEY,
        S3_PUBLIC_BUCKET,
        S3_PRIVATE_BUCKET,
        PUBLIC_ASSETS_URL,
    } = env;
    if (
        !S3_ENDPOINT ||
        !S3_ACCESS_KEY_ID ||
        !S3_SECRET_ACCESS_KEY ||
        !S3_PUBLIC_BUCKET ||
        !S3_PRIVATE_BUCKET ||
        !PUBLIC_ASSETS_URL
    ) {
        return null;
    }
    return createS3Storage({
        endpoint: S3_ENDPOINT,
        region: env.S3_REGION,
        accessKeyId: S3_ACCESS_KEY_ID,
        secretAccessKey: S3_SECRET_ACCESS_KEY,
        buckets: { public: S3_PUBLIC_BUCKET, private: S3_PRIVATE_BUCKET },
        publicBaseUrl: PUBLIC_ASSETS_URL,
    });
}
