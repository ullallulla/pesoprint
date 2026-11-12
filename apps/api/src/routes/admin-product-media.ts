import {
    adminProductFileSchema,
    adminProductImageSchema,
    confirmFileSchema,
    confirmImageSchema,
    createUploadSchema,
    updateImageSchema,
    uploadTicketSchema,
} from '@app/shared';
import { createRoute, z } from '@hono/zod-openapi';

import type { VerifySessionToken } from '../lib/auth.ts';
import { adminAuthResponses, errorResponse, idParams } from '../lib/openapi.ts';
import { createRouter } from '../lib/router.ts';
import { requireAdmin } from '../middleware/auth.ts';
import type { ProductMediaService } from '../services/product-media.ts';

export interface AdminProductMediaDeps {
    verifySessionToken: VerifySessionToken;
    productMedia: ProductMediaService;
}

const imageParams = idParams.extend({
    imageId: z.uuid().openapi({ param: { name: 'imageId', in: 'path' } }),
});
const fileParams = idParams.extend({
    fileId: z.uuid().openapi({ param: { name: 'fileId', in: 'path' } }),
});

const productNotFound = errorResponse('No product with this id.');
const storageMissing = errorResponse('File storage is not configured on this server.');

export function adminProductMediaRoutes(deps: AdminProductMediaDeps) {
    const adminOnly = requireAdmin(deps.verifySessionToken);

    const createUploadRoute = createRoute({
        tags: ['Admin: product media'],
        security: [{ bearerAuth: [] }],
        middleware: [adminOnly] as const,
        method: 'post',
        path: '/admin/products/{id}/uploads',
        summary: 'Start an upload',
        description: [
            'Uploading is three steps, so large files go straight from the browser to storage:',
            '1. Call this with what you are uploading. You get a `key` and a presigned `url`.',
            '2. `PUT` the file to `url` with the returned `headers`, before `expiresAt`.',
            '3. Confirm with `POST /images` or `POST /files`, passing the `key`.',
        ].join('\n'),
        request: {
            params: idParams,
            body: { required: true, content: { 'application/json': { schema: createUploadSchema } } },
        },
        responses: {
            201: {
                description: 'Where to upload the file.',
                content: { 'application/json': { schema: uploadTicketSchema } },
            },
            400: errorResponse('Unsupported type, or the file is too large.'),
            ...adminAuthResponses,
            404: productNotFound,
            503: storageMissing,
        },
    });

    const confirmImageRoute = createRoute({
        tags: ['Admin: product media'],
        security: [{ bearerAuth: [] }],
        middleware: [adminOnly] as const,
        method: 'post',
        path: '/admin/products/{id}/images',
        summary: 'Attach an uploaded image',
        description: 'Adds the image at the end of the gallery. The first image (lowest position) is the cover.',
        request: {
            params: idParams,
            body: { required: true, content: { 'application/json': { schema: confirmImageSchema } } },
        },
        responses: {
            201: {
                description: 'The new image.',
                content: { 'application/json': { schema: adminProductImageSchema } },
            },
            400: errorResponse('Invalid input, or no acceptable upload was found for the key.'),
            ...adminAuthResponses,
            404: productNotFound,
            409: errorResponse('The upload is already attached.'),
            503: storageMissing,
        },
    });

    const updateImageRoute = createRoute({
        tags: ['Admin: product media'],
        security: [{ bearerAuth: [] }],
        middleware: [adminOnly] as const,
        method: 'patch',
        path: '/admin/products/{id}/images/{imageId}',
        summary: 'Update an image',
        description: 'Change the alt text or the position (lowest position is the cover).',
        request: {
            params: imageParams,
            body: { required: true, content: { 'application/json': { schema: updateImageSchema } } },
        },
        responses: {
            200: {
                description: 'The updated image.',
                content: { 'application/json': { schema: adminProductImageSchema } },
            },
            400: errorResponse('Invalid input.'),
            ...adminAuthResponses,
            404: errorResponse('No such image on this product.'),
        },
    });

    const deleteImageRoute = createRoute({
        tags: ['Admin: product media'],
        security: [{ bearerAuth: [] }],
        middleware: [adminOnly] as const,
        method: 'delete',
        path: '/admin/products/{id}/images/{imageId}',
        summary: 'Delete an image',
        description: 'Deletes the image and its stored file. A published product must keep at least one image.',
        request: { params: imageParams },
        responses: {
            204: { description: 'Deleted.' },
            400: errorResponse('An id is not a UUID.'),
            ...adminAuthResponses,
            404: errorResponse('No such image on this product.'),
            409: errorResponse('It is the last image of a published product (see `issues`).'),
        },
    });

    const confirmFileRoute = createRoute({
        tags: ['Admin: product media'],
        security: [{ bearerAuth: [] }],
        middleware: [adminOnly] as const,
        method: 'post',
        path: '/admin/products/{id}/files',
        summary: 'Attach an uploaded model file',
        description:
            'Attaches a download or a preview, depending on the upload. A new preview replaces the previous one. The first STL of a product without a preview also gets a preview made from it.',
        request: {
            params: idParams,
            body: { required: true, content: { 'application/json': { schema: confirmFileSchema } } },
        },
        responses: {
            201: {
                description: 'The new file.',
                content: { 'application/json': { schema: adminProductFileSchema } },
            },
            400: errorResponse('Invalid input, or no acceptable upload was found for the key.'),
            ...adminAuthResponses,
            404: productNotFound,
            409: errorResponse('The upload is already attached.'),
            503: storageMissing,
        },
    });

    const generatePreviewRoute = createRoute({
        tags: ['Admin: product media'],
        security: [{ bearerAuth: [] }],
        middleware: [adminOnly] as const,
        method: 'post',
        path: '/admin/products/{id}/preview',
        summary: 'Make the 3D preview from the STL',
        description:
            "Builds a reduced GLB from the product's first STL download and makes it the preview, replacing the current one.",
        request: { params: idParams },
        responses: {
            201: {
                description: 'The new preview.',
                content: { 'application/json': { schema: adminProductFileSchema } },
            },
            400: errorResponse('The id is not a UUID.'),
            ...adminAuthResponses,
            404: productNotFound,
            409: errorResponse('The product has no STL, or it could not be read.'),
            503: storageMissing,
        },
    });

    const deleteFileRoute = createRoute({
        tags: ['Admin: product media'],
        security: [{ bearerAuth: [] }],
        middleware: [adminOnly] as const,
        method: 'delete',
        path: '/admin/products/{id}/files/{fileId}',
        summary: 'Delete a model file',
        description:
            'Deletes the file and its stored object. A published product that offers its file must keep a download.',
        request: { params: fileParams },
        responses: {
            204: { description: 'Deleted.' },
            400: errorResponse('An id is not a UUID.'),
            ...adminAuthResponses,
            404: errorResponse('No such file on this product.'),
            409: errorResponse('It is the last download of a published product (see `issues`).'),
        },
    });

    return createRouter()
        .openapi(createUploadRoute, async (c) => {
            return c.json(await deps.productMedia.createUpload(c.req.valid('param').id, c.req.valid('json')), 201);
        })
        .openapi(confirmImageRoute, async (c) => {
            return c.json(await deps.productMedia.confirmImage(c.req.valid('param').id, c.req.valid('json')), 201);
        })
        .openapi(updateImageRoute, async (c) => {
            const { id, imageId } = c.req.valid('param');
            return c.json(await deps.productMedia.updateImage(id, imageId, c.req.valid('json')), 200);
        })
        .openapi(deleteImageRoute, async (c) => {
            const { id, imageId } = c.req.valid('param');
            await deps.productMedia.removeImage(id, imageId);
            return c.body(null, 204);
        })
        .openapi(confirmFileRoute, async (c) => {
            return c.json(await deps.productMedia.confirmFile(c.req.valid('param').id, c.req.valid('json')), 201);
        })
        .openapi(generatePreviewRoute, async (c) => {
            return c.json(await deps.productMedia.generatePreview(c.req.valid('param').id), 201);
        })
        .openapi(deleteFileRoute, async (c) => {
            const { id, fileId } = c.req.valid('param');
            await deps.productMedia.removeFile(id, fileId);
            return c.body(null, 204);
        });
}
