import { CLIENT_IP_HEADER, downloadLinkSchema, PROXY_SECRET_HEADER } from '@app/shared';
import { createRoute, z } from '@hono/zod-openapi';

import type { VerifySessionToken } from '../lib/auth.ts';
import { clientIp } from '../lib/client-ip.ts';
import { errorResponse } from '../lib/openapi.ts';
import { createRouter } from '../lib/router.ts';
import { optionalAuth } from '../middleware/auth.ts';
import type { DownloadsService } from '../services/downloads.ts';

export interface DownloadDeps {
    verifySessionToken: VerifySessionToken;
    downloads: DownloadsService;
    /** `INTERNAL_API_SECRET`: when the web server sends it, its client-IP header is trusted. */
    internalApiSecret: string | undefined;
}

export function downloadRoutes(deps: DownloadDeps) {
    const startRoute = createRoute({
        tags: ['Downloads'],
        // Optional: signing in only matters for admins (and, from M3, for buyers of paid files).
        security: [{ bearerAuth: [] }],
        middleware: [optionalAuth(deps.verifySessionToken)] as const,
        method: 'post',
        path: '/downloads/{fileId}',
        summary: 'Get a download link',
        description: [
            'Returns a link to one model file that works for 5 minutes. Anyone may download the files of free,',
            'published models; admins may download any file. Everything else is a 404. Visitors are limited to',
            '30 downloads an hour (by anonymised IP; admins are not limited).',
            '',
            `The web server passes on the visitor's IP in \`${CLIENT_IP_HEADER}\`, with the shared secret in`,
            `\`${PROXY_SECRET_HEADER}\`. IPs are only stored as a daily keyed hash.`,
        ].join('\n'),
        request: {
            params: z.object({
                fileId: z.uuid().openapi({ param: { name: 'fileId', in: 'path' } }),
            }),
        },
        responses: {
            200: {
                description: 'The download link.',
                content: { 'application/json': { schema: downloadLinkSchema } },
            },
            400: errorResponse('The id is not a UUID.'),
            401: errorResponse('A session token was sent, but it is invalid or has expired.'),
            404: errorResponse("No such file, or you can't download it."),
            429: errorResponse(
                'Too many downloads from this visitor in the last hour. `Retry-After` says when to try again.',
            ),
            503: errorResponse('File storage is not configured.'),
        },
    });

    return createRouter().openapi(startRoute, async (c) => {
        const link = await deps.downloads.start({
            fileId: c.req.valid('param').fileId,
            caller: c.get('auth') ?? undefined,
            ip: clientIp(c.req.raw.headers, deps.internalApiSecret),
        });
        // A link is personal and short-lived: never cache it.
        c.header('Cache-Control', 'no-store');
        return c.json(link, 200);
    });
}
