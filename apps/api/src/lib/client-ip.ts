import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

import { CLIENT_IP_HEADER, PROXY_SECRET_HEADER } from '@app/shared';

/**
 * The visitor's IP address, or `null` if it can't be told reliably.
 *
 * - From the web server: it forwards the visitor's IP with the shared `INTERNAL_API_SECRET`.
 *   Without the secret the header is ignored, because anyone can call the API directly.
 * - Otherwise: the last `X-Forwarded-For` entry, which our host's proxy (Render) adds itself. Earlier
 *   entries come from the client and can be made up.
 */
export function clientIp(headers: Headers, proxySecret: string | undefined): string | null {
    if (proxySecret) {
        const given = headers.get(PROXY_SECRET_HEADER);
        if (given !== null && sameSecret(given, proxySecret)) {
            return validIp(headers.get(CLIENT_IP_HEADER));
        }
    }
    return validIp(headers.get('x-forwarded-for')?.split(',').at(-1));
}

function validIp(value: string | null | undefined): string | null {
    const ip = value?.trim();
    return ip && isIP(ip) ? ip : null;
}

function sameSecret(given: string, expected: string): boolean {
    const a = Buffer.from(given);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
}

/** Turns an IP address into the value stored in `download_events.ip_hash`. */
export type IpHasher = (ip: string | null, now?: Date) => string | null;

/**
 * Keyed hash of the IP and the UTC date. The same visitor gets the same hash all day (for rate limiting),
 * a different one the next day, and without the secret the hash can't be matched to an address.
 * Without `secret`, a random one is made per process: hashes then change when the API restarts.
 */
export function createIpHasher(secret: string | undefined): IpHasher {
    const key = secret ?? randomBytes(32).toString('hex');
    return (ip, now = new Date()) => {
        if (ip === null) return null;
        const day = now.toISOString().slice(0, 10);
        return createHmac('sha256', key).update(`${day}|${ip}`).digest('hex').slice(0, 32);
    };
}
