import { adminProductFileSchema, adminProductImageSchema, uploadTicketSchema } from '@app/shared';
import { data } from 'react-router';

import { mediaRequestSchema } from '~/lib/admin-upload';
import { adminApi, requireSession } from '~/lib/admin.server';
import { ApiRequestError } from '~/lib/api.server';

import type { Route } from './+types/product-media';

// The browser's upload steps (see ~/lib/admin-upload). The file itself goes straight to storage, never through here.

export async function action(args: Route.ActionArgs) {
    await requireSession(args);
    const parsed = mediaRequestSchema.safeParse(await args.request.json().catch(() => null));
    if (!parsed.success) {
        return data({ message: parsed.error.issues[0]?.message ?? 'Invalid request.' }, { status: 400 });
    }
    const base = `/api/admin/products/${encodeURIComponent(args.params.id)}`;
    const request = parsed.data;

    try {
        switch (request.op) {
            case 'ticket':
                return await adminApi(args, `${base}/uploads`, uploadTicketSchema, {
                    method: 'POST',
                    json: request.upload,
                });
            case 'confirm-image':
                return await adminApi(args, `${base}/images`, adminProductImageSchema, {
                    method: 'POST',
                    json: request.image,
                });
            case 'confirm-file':
                return await adminApi(args, `${base}/files`, adminProductFileSchema, {
                    method: 'POST',
                    json: request.file,
                });
        }
    } catch (error) {
        if (error instanceof ApiRequestError && [400, 404, 409, 503].includes(error.status)) {
            const message =
                error.status === 503
                    ? 'File storage is not configured on the API, so files cannot be uploaded.'
                    : (error.apiError?.issues?.[0]?.message ?? error.message);
            return data({ message }, { status: error.status });
        }
        throw error;
    }
}
