import { existsSync } from 'node:fs';

import { z } from 'zod';

const envSchema = z.object({
    /** Base URL the web server uses to reach the API, e.g. http://localhost:3001 */
    API_URL: z.url().default('http://localhost:3001'),
    /** Public address of the site, used for canonical URLs, Open Graph tags and the sitemap. No trailing slash. */
    SITE_URL: z
        .url()
        .default('http://localhost:5173')
        .transform((url) => url.replace(/\/+$/, '')),
    /**
     * Same value as the API's INTERNAL_API_SECRET. With it, download requests tell the API the visitor's
     * IP (for rate limits); without it the API only sees this server's IP.
     */
    INTERNAL_API_SECRET: z.string().min(32, 'INTERNAL_API_SECRET must be at least 32 characters').optional(),
    /**
     * PostHog project API key (phc_…, public by design). Without it there are no analytics, and no
     * cookie banner since nothing optional is set.
     */
    POSTHOG_KEY: z.string().startsWith('phc_', 'POSTHOG_KEY is the project API key and starts with phc_').optional(),
    /** PostHog region: EU Cloud keeps the data in Frankfurt. */
    POSTHOG_HOST: z.url().default('https://eu.i.posthog.com'),
});

export type WebEnv = z.infer<typeof envSchema>;

let cached: WebEnv | undefined;

/** Validated server-side environment. The `.server` suffix keeps this out of the browser bundle. */
export function getEnv(): WebEnv {
    if (!cached) {
        // Local development: read apps/web/.env. In production the container provides the variables.
        if (process.env.NODE_ENV !== 'production' && existsSync('.env')) {
            process.loadEnvFile('.env');
        }
        const result = envSchema.safeParse(process.env);
        if (!result.success) {
            throw new Error(`Invalid environment variables:\n${z.prettifyError(result.error)}`);
        }
        cached = result.data;
    }
    return cached;
}
