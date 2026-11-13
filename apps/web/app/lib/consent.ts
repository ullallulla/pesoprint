/**
 * The visitor's answer to the cookie banner, kept in a first-party cookie so the server can render the
 * page with or without the banner (no flash on load). The cookie itself is strictly necessary: it only
 * remembers the choice.
 */
export const CONSENT_COOKIE = 'pesoprint_consent';

/** Ask again after about six months. */
export const CONSENT_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

export type Consent = 'granted' | 'denied';

/** The stored choice from a `Cookie` header (or `document.cookie`); null if the visitor hasn't answered. */
export function readConsent(cookies: string | null | undefined): Consent | null {
    for (const part of (cookies ?? '').split(';')) {
        const [name, ...rest] = part.trim().split('=');
        if (name === CONSENT_COOKIE) {
            const value = rest.join('=');
            return value === 'granted' || value === 'denied' ? value : null;
        }
    }
    return null;
}

/** A `document.cookie` assignment that stores the choice for the whole site. */
export function consentCookie(consent: Consent, { secure }: { secure: boolean }): string {
    return [
        `${CONSENT_COOKIE}=${consent}`,
        'Path=/',
        `Max-Age=${CONSENT_MAX_AGE_SECONDS}`,
        'SameSite=Lax',
        ...(secure ? ['Secure'] : []),
    ].join('; ');
}

/** PostHog keeps its state in cookies and storage entries whose names start with these. */
const ANALYTICS_STORAGE_PREFIXES = ['ph_', '__ph'];

export const isAnalyticsStorageKey = (name: string) =>
    ANALYTICS_STORAGE_PREFIXES.some((prefix) => name.startsWith(prefix));

/** Names of the analytics cookies in a `document.cookie` string, so they can be deleted. */
export function analyticsCookieNames(cookies: string): string[] {
    return cookies
        .split(';')
        .map((part) => part.trim().split('=')[0] ?? '')
        .filter(isAnalyticsStorageKey);
}
