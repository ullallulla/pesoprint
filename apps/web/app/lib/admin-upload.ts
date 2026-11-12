import {
    confirmFileSchema,
    confirmImageSchema,
    createUploadSchema,
    DOWNLOAD_EXTENSIONS,
    IMAGE_CONTENT_TYPES,
    MAX_UPLOAD_BYTES,
    uploadTicketSchema,
    type CreateUpload,
    type UploadTarget,
} from '@app/shared';
import { z } from 'zod';

import { formatBytes } from '~/lib/format';

/**
 * Uploading a product image or file, in the browser:
 * 1. ask the web server (`/admin/products/:id/media`, which asks the API) where to upload,
 * 2. PUT the file straight to storage with the signed URL,
 * 3. tell the web server it's there, so the API attaches it to the product.
 */

export const mediaRequestSchema = z.discriminatedUnion('op', [
    z.object({ op: z.literal('ticket'), upload: createUploadSchema }),
    z.object({ op: z.literal('confirm-image'), image: confirmImageSchema }),
    z.object({ op: z.literal('confirm-file'), file: confirmFileSchema }),
]);
export type MediaRequest = z.infer<typeof mediaRequestSchema>;

const mediaErrorSchema = z.object({ message: z.string() });

/** What file pickers accept for each target. */
export const UPLOAD_ACCEPT: Record<UploadTarget, string> = {
    image: Object.keys(IMAGE_CONTENT_TYPES).join(','),
    download: Object.keys(DOWNLOAD_EXTENSIONS)
        .map((extension) => `.${extension}`)
        .join(','),
    preview: '.glb',
};

/** The upload request for a file, or why it can't be uploaded. Same rules as the API, checked before uploading. */
export function uploadRequestFor(
    target: UploadTarget,
    file: { name: string; type: string; size: number },
): { ok: true; upload: CreateUpload } | { ok: false; message: string } {
    const max = MAX_UPLOAD_BYTES[target];
    if (file.size === 0) return { ok: false, message: `${file.name} is empty.` };
    if (file.size > max) {
        return { ok: false, message: `${file.name} is ${formatBytes(file.size)}; the limit is ${formatBytes(max)}.` };
    }
    const upload =
        target === 'image'
            ? { target, contentType: file.type, sizeBytes: file.size }
            : { target, filename: file.name, sizeBytes: file.size };
    const parsed = createUploadSchema.safeParse(upload);
    if (parsed.success) return { ok: true, upload: parsed.data };
    if (target === 'image') return { ok: false, message: `${file.name} isn't a JPEG, PNG, WebP or AVIF image.` };
    return { ok: false, message: parsed.error.issues[0]?.message ?? `${file.name} can't be uploaded here.` };
}

async function postMedia<T extends z.ZodType>(
    productId: string,
    request: MediaRequest,
    schema: T,
): Promise<z.output<T>> {
    const response = await fetch(`/admin/products/${encodeURIComponent(productId)}/media`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(request),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
        const error = mediaErrorSchema.safeParse(body);
        throw new Error(
            error.success
                ? error.data.message
                : response.status === 401 || response.status === 403
                  ? 'Your session has ended. Sign in again.'
                  : 'The server could not handle the upload. Try again.',
        );
    }
    return schema.parse(body);
}

/** PUTs the file to storage, reporting progress from 0 to 1. `fetch` can't report upload progress. */
function putFile(url: string, headers: Record<string, string>, file: File, onProgress: (fraction: number) => void) {
    return new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', url);
        for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
        xhr.upload.addEventListener('progress', (event) => {
            if (event.lengthComputable) onProgress(event.loaded / event.total);
        });
        xhr.addEventListener('load', () =>
            xhr.status >= 200 && xhr.status < 300
                ? resolve()
                : reject(new Error(`Storage refused the upload (${xhr.status}).`)),
        );
        xhr.addEventListener('error', () =>
            reject(new Error('The upload failed. Check the connection and try again.')),
        );
        xhr.send(file);
    });
}

/** Pixel size of an image file, as the browser decodes it. */
function imageSize(file: File): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => {
            URL.revokeObjectURL(url);
            resolve({ width: image.naturalWidth, height: image.naturalHeight });
        };
        image.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error(`${file.name} could not be read as an image.`));
        };
        image.src = url;
    });
}

export interface UploadOptions {
    productId: string;
    target: UploadTarget;
    file: File;
    /** Alt text for an image. It can be edited afterwards. */
    alt?: string;
    onProgress?: (fraction: number) => void;
}

/** Uploads one file and attaches it to the product. Throws an `Error` whose message can be shown as is. */
export async function uploadProductMedia({ productId, target, file, alt, onProgress = () => {} }: UploadOptions) {
    const request = uploadRequestFor(target, file);
    if (!request.ok) throw new Error(request.message);

    // Measure before uploading, so an unreadable image doesn't leave an orphan in storage.
    const size = target === 'image' ? await imageSize(file) : null;

    const ticket = await postMedia(productId, { op: 'ticket', upload: request.upload }, uploadTicketSchema);
    await putFile(ticket.url, ticket.headers, file, onProgress);

    if (size) {
        await postMedia(
            productId,
            { op: 'confirm-image', image: { key: ticket.key, alt: alt || file.name, ...size } },
            z.unknown(),
        );
    } else {
        await postMedia(productId, { op: 'confirm-file', file: { key: ticket.key, filename: file.name } }, z.unknown());
    }
}
