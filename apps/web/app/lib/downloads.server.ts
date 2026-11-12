import { CLIENT_IP_HEADER, downloadLinkSchema, PROXY_SECRET_HEADER, type DownloadLink } from '@app/shared';
import { getAuth } from '@clerk/react-router/server';
import { isIP } from 'node:net';
import type { LoaderFunctionArgs } from 'react-router';

import { getEnv } from '~/env.server';
import { apiFetch } from '~/lib/api.server';

/**
 * The visitor's IP: the last `X-Forwarded-For` entry, which our host's proxy (Render) adds. Earlier entries
 * come from the client and can be made up. `null` locally, where there is no proxy.
 */
export function visitorIp(request: Request): string | null {
    const ip = request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim();
    return ip && isIP(ip) ? ip : null;
}

/**
 * Asks the API for a download link on the visitor's behalf: with their session if they're signed in
 * (admins can download drafts), and with their IP for the API's rate limits.
 */
export async function requestDownload(args: LoaderFunctionArgs, fileId: string): Promise<DownloadLink> {
    const { isAuthenticated, getToken } = await getAuth(args);
    const secret = getEnv().INTERNAL_API_SECRET;
    const ip = visitorIp(args.request);

    const headers = new Headers();
    if (secret) {
        headers.set(PROXY_SECRET_HEADER, secret);
        if (ip) headers.set(CLIENT_IP_HEADER, ip);
    }
    return apiFetch(`/api/downloads/${encodeURIComponent(fileId)}`, downloadLinkSchema, {
        method: 'POST',
        headers,
        token: isAuthenticated ? await getToken() : null,
    });
}
