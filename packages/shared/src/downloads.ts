import { z } from 'zod';

/** A short-lived link to one model file. Send the browser there; it saves the file under `filename`. */
export const downloadLinkSchema = z
    .object({
        url: z.url(),
        filename: z.string(),
        expiresAt: z.iso.datetime(),
    })
    .meta({ id: 'DownloadLink' });
export type DownloadLink = z.infer<typeof downloadLinkSchema>;

/**
 * Headers the web server adds when it asks the API for a download on a visitor's behalf. The API only
 * believes the client IP when the shared secret matches; anyone can call the API directly otherwise.
 */
export const CLIENT_IP_HEADER = 'x-pesoprint-client-ip';
export const PROXY_SECRET_HEADER = 'x-pesoprint-proxy-secret';
