import { z } from 'zod';

import type { ProductFileFormat } from './products.ts';

const MB = 1024 * 1024;

/**
 * What can be uploaded for a product:
 * - `image`: gallery photos, stored in the public bucket.
 * - `download`: the model file buyers download, stored in the private bucket.
 * - `preview`: the GLB for the public 3D viewer. Must be a decimated mesh, so it can't stand in for the paid file.
 */
export const UPLOAD_TARGETS = ['image', 'download', 'preview'] as const;
export type UploadTarget = (typeof UPLOAD_TARGETS)[number];

export const MAX_UPLOAD_BYTES: Record<UploadTarget, number> = {
    image: 10 * MB,
    download: 1024 * MB,
    // Deliberately small: a preview over this size is probably the full-resolution model.
    preview: 25 * MB,
};

/** Accepted image types and the file extension each is stored with. */
export const IMAGE_CONTENT_TYPES = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/avif': 'avif',
} as const;
export type ImageContentType = keyof typeof IMAGE_CONTENT_TYPES;

/**
 * Model file extensions and the format each maps to. Browsers report model files' content types
 * inconsistently (often empty), so the format comes from the extension and the server picks the content type.
 */
export const DOWNLOAD_EXTENSIONS: Record<string, ProductFileFormat> = {
    stl: 'stl',
    '3mf': '3mf',
    step: 'step',
    stp: 'step',
    obj: 'obj',
};

/** The content type each model format is stored with (browsers' guesses are unreliable for these). */
export const MODEL_CONTENT_TYPES: Record<ProductFileFormat, string> = {
    stl: 'model/stl',
    '3mf': 'model/3mf',
    step: 'model/step',
    obj: 'model/obj',
    glb: 'model/gltf-binary',
};

/** The lowercase extension of a file name, without the dot. Empty if there is none. */
export function fileExtension(filename: string): string {
    const dot = filename.lastIndexOf('.');
    return dot > 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

const filenameSchema = z.string().trim().min(1).max(255);
const sizeSchema = (target: UploadTarget) => z.int().min(1).max(MAX_UPLOAD_BYTES[target]);

/** Step 1 of an upload: ask the API where to PUT the file. */
export const createUploadSchema = z
    .discriminatedUnion('target', [
        z.object({
            target: z.literal('image'),
            contentType: z.enum(Object.keys(IMAGE_CONTENT_TYPES) as [ImageContentType, ...ImageContentType[]]),
            sizeBytes: sizeSchema('image'),
        }),
        z.object({
            target: z.literal('download'),
            filename: filenameSchema.refine((name) => fileExtension(name) in DOWNLOAD_EXTENSIONS, {
                message: `Upload a ${Object.keys(DOWNLOAD_EXTENSIONS).join(', ')} file.`,
            }),
            sizeBytes: sizeSchema('download'),
        }),
        z.object({
            target: z.literal('preview'),
            filename: filenameSchema.refine((name) => fileExtension(name) === 'glb', {
                message: 'The preview must be a .glb file.',
            }),
            sizeBytes: sizeSchema('preview'),
        }),
    ])
    .meta({ id: 'CreateUpload' });
export type CreateUpload = z.infer<typeof createUploadSchema>;

/** Where and how the browser uploads the file. The URL expires; ask again if it does. */
export const uploadTicketSchema = z
    .object({
        /** Pass this back when confirming the upload. */
        key: z.string(),
        method: z.literal('PUT'),
        url: z.url(),
        /** Send exactly these headers with the PUT; they are part of the signature. */
        headers: z.record(z.string(), z.string()),
        expiresAt: z.iso.datetime(),
    })
    .meta({ id: 'UploadTicket' });
export type UploadTicket = z.infer<typeof uploadTicketSchema>;

/** Step 3 for images: the file is uploaded, attach it to the product. */
export const confirmImageSchema = z
    .object({
        key: z.string().min(1).max(500),
        /** Describes the photo for screen readers and search engines. */
        alt: z.string().trim().min(1).max(300),
        /** Pixel size, measured in the browser (`naturalWidth` / `naturalHeight`). */
        width: z.int().min(1).max(20_000),
        height: z.int().min(1).max(20_000),
    })
    .meta({ id: 'ConfirmImage' });
export type ConfirmImage = z.infer<typeof confirmImageSchema>;

/** Step 3 for model files (download or preview). A new preview replaces the old one. */
export const confirmFileSchema = z
    .object({
        key: z.string().min(1).max(500),
        /** The original file name, used when the file is downloaded. */
        filename: filenameSchema,
    })
    .meta({ id: 'ConfirmFile' });
export type ConfirmFile = z.infer<typeof confirmFileSchema>;

export const updateImageSchema = z
    .object({
        alt: z.string().trim().min(1).max(300).optional(),
        /** Lowest position is the cover image. */
        position: z.int().min(0).max(1000).optional(),
    })
    .meta({ id: 'UpdateImage' });
export type UpdateImage = z.infer<typeof updateImageSchema>;
