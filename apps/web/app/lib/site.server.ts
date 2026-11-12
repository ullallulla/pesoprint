import { getEnv } from '~/env.server';

/** Absolute URL on the public site, e.g. `absoluteUrl('/models/dragon')`. */
export function absoluteUrl(path: string): string {
    return `${getEnv().SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}
