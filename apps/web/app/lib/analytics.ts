import type { PostHog } from 'posthog-js';

import { analyticsCookieNames, isAnalyticsStorageKey } from './consent';

/** Public PostHog project settings. The project key is meant to be public (it can only send events). */
export interface AnalyticsConfig {
    key: string;
    /** e.g. https://eu.i.posthog.com */
    host: string;
}

let loading: Promise<PostHog> | null = null;

/** Admins working in the admin pages aren't visitors; their clicks would only skew the numbers. */
const isAdminPage = () => window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/');

/**
 * Loads and starts PostHog. Only called once the visitor has allowed statistics cookies:
 * before that, the PostHog script isn't even downloaded.
 */
export function startAnalytics(config: AnalyticsConfig): Promise<PostHog> {
    loading ??= import('posthog-js').then(({ default: posthog }) => {
        posthog.init(config.key, {
            api_host: config.host,
            // Pinned, so an SDK update can't change what is collected. Includes page views on client-side navigation.
            defaults: '2026-08-30',
            // Anonymous statistics only: visitors are never linked to their account.
            person_profiles: 'identified_only',
            // Not covered by the privacy policy: no screen recordings, no pop-up surveys.
            disable_session_recording: true,
            disable_surveys: true,
            before_send: (event) => (event && isAdminPage() ? null : event),
        });
        return posthog;
    });
    return loading;
}

/** Our own events and their properties. Keep names stable: insights and dashboards in PostHog use them. */
export interface AnalyticsEvents {
    /** A visitor clicked a free model's Download button. */
    model_downloaded: {
        model: string;
        model_title: string;
        category: string | null;
        file_format: string;
        file_id: string;
    };
}

/**
 * Sends one of our events, if the visitor allowed statistics. Otherwise PostHog isn't loaded and
 * nothing happens.
 */
export function track<E extends keyof AnalyticsEvents>(event: E, properties: AnalyticsEvents[E]): void {
    if (!loading) return;
    void loading.then((posthog) => {
        // A beacon is still delivered if the click leaves the page.
        posthog.capture(event, properties, { send_instantly: true, transport: 'sendBeacon' });
    });
}

/** Removes PostHog's cookies and stored data, e.g. after the visitor withdraws consent. */
export function clearAnalyticsStorage(): void {
    const names = analyticsCookieNames(document.cookie);
    if (names.length > 0) {
        // PostHog may set its cookie on the parent domain (shared with subdomains), so expire it on each one.
        const labels = window.location.hostname.split('.');
        const domains = ['', ...labels.slice(0, -1).map((_, i) => `; Domain=.${labels.slice(i).join('.')}`)];
        for (const name of names) {
            for (const domain of domains) {
                document.cookie = `${name}=; Path=/; Max-Age=0${domain}`;
            }
        }
    }
    for (const storage of [window.localStorage, window.sessionStorage]) {
        for (const key of Object.keys(storage).filter(isAnalyticsStorageKey)) {
            storage.removeItem(key);
        }
    }
}

/**
 * Stops PostHog after the visitor withdraws consent. The page reloads, so nothing of PostHog stays in
 * memory and no further events can be sent; the next page load clears what it stored.
 */
export async function stopAnalytics(): Promise<void> {
    if (loading) {
        const posthog = await loading;
        posthog.opt_out_capturing();
    }
    clearAnalyticsStorage();
    window.location.reload();
}
