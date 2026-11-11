import { randomUUID } from 'node:crypto';

import {
    DOWNLOAD_EXTENSIONS,
    IMAGE_CONTENT_TYPES,
    MAX_UPLOAD_BYTES,
    MODEL_CONTENT_TYPES,
    fileExtension,
    publishProblems,
    type AdminProductFile,
    type AdminProductImage,
    type ConfirmFile,
    type ConfirmImage,
    type CreateUpload,
    type ProductFileFormat,
    type ProductFileKind,
    type UpdateImage,
    type UploadTarget,
    type UploadTicket,
} from '@app/shared';
import { and, eq, max } from 'drizzle-orm';

import type { Database } from '../db/client.ts';
import { isPgError, PgErrorCode } from '../db/errors.ts';
import {
    productFiles,
    productImages,
    products,
    type Product,
    type ProductFile,
    type ProductImage,
} from '../db/schema.ts';
import { AppError, conflict, invalidField, notFound } from '../lib/errors.ts';
import { definedFields } from '../lib/patch.ts';
import { deleteStoredFiles, type Bucket, type Storage, type StoredFileRef } from '../lib/storage.ts';
import { contentCounts, lockProduct, type Executor } from './products.ts';

/** Downloads are private (signed URLs only); previews are public so the 3D viewer can load them. */
export const bucketForFileKind = (kind: ProductFileKind): Bucket => (kind === 'download' ? 'private' : 'public');

export function toAdminImage(row: ProductImage, storage: Storage | null): AdminProductImage {
    return {
        id: row.id,
        url: storage ? storage.publicUrl(row.storageKey) : null,
        alt: row.alt,
        width: row.width,
        height: row.height,
        sizeBytes: row.sizeBytes,
        position: row.position,
    };
}

export function toAdminFile(row: ProductFile, storage: Storage | null): AdminProductFile {
    return {
        id: row.id,
        kind: row.kind,
        url: storage && row.kind === 'preview' ? storage.publicUrl(row.storageKey) : null,
        format: row.format,
        filename: row.filename,
        sizeBytes: row.sizeBytes,
        position: row.position,
    };
}

export const imageRef = (row: Pick<ProductImage, 'storageKey'>): StoredFileRef => ({
    bucket: 'public',
    key: row.storageKey,
});

export const fileRef = (row: Pick<ProductFile, 'kind' | 'storageKey'>): StoredFileRef => ({
    bucket: bucketForFileKind(row.kind),
    key: row.storageKey,
});

// ---------------------------------------------------------------------------
// Uploads, images and files

export interface ProductMediaService {
    /** Step 1: reserve a storage key and return a presigned PUT URL for it. */
    createUpload(productId: string, input: CreateUpload): Promise<UploadTicket>;
    /** Step 3: check the uploaded image exists and attach it to the product (at the end of the gallery). */
    confirmImage(productId: string, input: ConfirmImage): Promise<AdminProductImage>;
    /** Step 3: check the uploaded model file exists and attach it. A new preview replaces the old one. */
    confirmFile(productId: string, input: ConfirmFile): Promise<AdminProductFile>;
    updateImage(productId: string, imageId: string, input: UpdateImage): Promise<AdminProductImage>;
    removeImage(productId: string, imageId: string): Promise<void>;
    removeFile(productId: string, fileId: string): Promise<void>;
}

/** Storage folder for each upload target. The folder in a key tells the API what the file is. */
const FOLDERS = { image: 'images', download: 'files', preview: 'preview' } as const satisfies Record<
    UploadTarget,
    string
>;

const bucketForTarget = (target: UploadTarget): Bucket => (target === 'download' ? 'private' : 'public');

/** Reads `products/{productId}/{folder}/{uuid}.{ext}`; `null` if the key isn't an upload key of this product. */
function parseKey(productId: string, key: string): { target: UploadTarget; extension: string } | null {
    const match = /^products\/([0-9a-f-]{36})\/(images|files|preview)\/[0-9a-f-]{36}\.([a-z0-9]+)$/.exec(key);
    if (!match || match[1] !== productId) return null;
    const target = (Object.keys(FOLDERS) as UploadTarget[]).find((t) => FOLDERS[t] === match[2])!;
    return { target, extension: match[3]! };
}

const storageNotConfigured = () =>
    new AppError(503, 'internal_error', 'File storage is not configured on this server.');

/** A published product must stay publishable when content is removed (same rule as editing it). */
async function assertStillPublishable(
    tx: Executor,
    product: Product,
    change: { imageCount?: -1; downloadFileCount?: -1 },
): Promise<void> {
    if (product.status !== 'published') return;
    const counts = await contentCounts(tx, product.id);
    const problems = publishProblems({
        ...product,
        imageCount: counts.imageCount + (change.imageCount ?? 0),
        downloadFileCount: counts.downloadFileCount + (change.downloadFileCount ?? 0),
    });
    if (problems.length > 0) {
        throw conflict('A published product must stay ready to publish.', problems);
    }
}

export function createProductMediaService(db: Database, storage: Storage | null): ProductMediaService {
    /** Checks the object was uploaded and is within the limits; deletes it if it isn't acceptable. */
    async function verifyUpload(bucket: Bucket, key: string, target: UploadTarget, allowedTypes?: string[]) {
        if (!storage) throw storageNotConfigured();
        const object = await storage.head(bucket, key);
        if (!object) {
            throw invalidField('key', 'No uploaded file was found for this key. Upload the file first.');
        }
        const typeAllowed =
            !allowedTypes || (object.contentType !== undefined && allowedTypes.includes(object.contentType));
        if (object.sizeBytes <= 0 || object.sizeBytes > MAX_UPLOAD_BYTES[target] || !typeAllowed) {
            await deleteStoredFiles(storage, [{ bucket, key }]);
            throw invalidField('key', 'The uploaded file is empty, too large or of the wrong type. Upload it again.');
        }
        return object;
    }

    function rethrowAlreadyAttached(error: unknown): never {
        if (
            isPgError(error, PgErrorCode.uniqueViolation, 'product_images_storage_key_unique') ||
            isPgError(error, PgErrorCode.uniqueViolation, 'product_files_storage_key_unique')
        ) {
            throw conflict('This upload is already attached to the product.');
        }
        throw error;
    }

    return {
        async createUpload(productId, input) {
            if (!storage) throw storageNotConfigured();
            const [product] = await db.select({ id: products.id }).from(products).where(eq(products.id, productId));
            if (!product) throw notFound('Product not found.');

            let extension: string;
            let contentType: string;
            if (input.target === 'image') {
                extension = IMAGE_CONTENT_TYPES[input.contentType];
                contentType = input.contentType;
            } else {
                const format = input.target === 'preview' ? 'glb' : DOWNLOAD_EXTENSIONS[fileExtension(input.filename)]!;
                extension = format; // `.stp` is stored as `.step`
                contentType = MODEL_CONTENT_TYPES[format];
            }

            const key = `products/${productId}/${FOLDERS[input.target]}/${randomUUID()}.${extension}`;
            const upload = await storage.presignUpload({
                bucket: bucketForTarget(input.target),
                key,
                contentType,
                sizeBytes: input.sizeBytes,
            });
            return {
                key,
                method: 'PUT',
                url: upload.url,
                headers: upload.headers,
                expiresAt: upload.expiresAt.toISOString(),
            };
        },

        async confirmImage(productId, input) {
            if (parseKey(productId, input.key)?.target !== 'image') {
                throw invalidField('key', 'This key is not an image upload for this product.');
            }
            const object = await verifyUpload('public', input.key, 'image', Object.keys(IMAGE_CONTENT_TYPES));

            return db.transaction(async (tx) => {
                await lockProduct(tx, productId);
                const [last] = await tx
                    .select({ value: max(productImages.position) })
                    .from(productImages)
                    .where(eq(productImages.productId, productId));
                try {
                    const [row] = await tx
                        .insert(productImages)
                        .values({
                            productId,
                            storageKey: input.key,
                            alt: input.alt,
                            width: input.width,
                            height: input.height,
                            sizeBytes: object.sizeBytes,
                            position: (last?.value ?? -1) + 1,
                        })
                        .returning();
                    return toAdminImage(row!, storage);
                } catch (error) {
                    rethrowAlreadyAttached(error);
                }
            });
        },

        async confirmFile(productId, input) {
            const parsed = parseKey(productId, input.key);
            if (!parsed || parsed.target === 'image') {
                throw invalidField('key', 'This key is not a model file upload for this product.');
            }
            const kind: ProductFileKind = parsed.target;
            const format = parsed.extension as ProductFileFormat;
            const object = await verifyUpload(bucketForTarget(parsed.target), input.key, parsed.target);

            const { row, replaced } = await db.transaction(async (tx) => {
                await lockProduct(tx, productId);

                let replaced: ProductFile[] = [];
                let position = 0;
                if (kind === 'preview') {
                    replaced = await tx
                        .delete(productFiles)
                        .where(and(eq(productFiles.productId, productId), eq(productFiles.kind, 'preview')))
                        .returning();
                } else {
                    const [last] = await tx
                        .select({ value: max(productFiles.position) })
                        .from(productFiles)
                        .where(eq(productFiles.productId, productId));
                    position = (last?.value ?? -1) + 1;
                }

                try {
                    const [row] = await tx
                        .insert(productFiles)
                        .values({
                            productId,
                            kind,
                            format,
                            filename: input.filename,
                            storageKey: input.key,
                            sizeBytes: object.sizeBytes,
                            position,
                        })
                        .returning();
                    return { row: row!, replaced };
                } catch (error) {
                    rethrowAlreadyAttached(error);
                }
            });

            await deleteStoredFiles(storage, replaced.map(fileRef));
            return toAdminFile(row, storage);
        },

        async updateImage(productId, imageId, input) {
            const changes = definedFields(input);
            const [row] =
                Object.keys(changes).length > 0
                    ? await db
                          .update(productImages)
                          .set(changes)
                          .where(and(eq(productImages.id, imageId), eq(productImages.productId, productId)))
                          .returning()
                    : await db
                          .select()
                          .from(productImages)
                          .where(and(eq(productImages.id, imageId), eq(productImages.productId, productId)));
            if (!row) throw notFound('Image not found.');
            return toAdminImage(row, storage);
        },

        async removeImage(productId, imageId) {
            const removed = await db.transaction(async (tx) => {
                const product = await lockProduct(tx, productId);
                const [image] = await tx
                    .select()
                    .from(productImages)
                    .where(and(eq(productImages.id, imageId), eq(productImages.productId, productId)));
                if (!image) throw notFound('Image not found.');

                await assertStillPublishable(tx, product, { imageCount: -1 });
                await tx.delete(productImages).where(eq(productImages.id, imageId));
                return image;
            });
            await deleteStoredFiles(storage, [imageRef(removed)]);
        },

        async removeFile(productId, fileId) {
            const removed = await db.transaction(async (tx) => {
                const product = await lockProduct(tx, productId);
                const [file] = await tx
                    .select()
                    .from(productFiles)
                    .where(and(eq(productFiles.id, fileId), eq(productFiles.productId, productId)));
                if (!file) throw notFound('File not found.');

                if (file.kind === 'download') {
                    await assertStillPublishable(tx, product, { downloadFileCount: -1 });
                }
                await tx.delete(productFiles).where(eq(productFiles.id, fileId));
                return file;
            });
            await deleteStoredFiles(storage, [fileRef(removed)]);
        },
    };
}
