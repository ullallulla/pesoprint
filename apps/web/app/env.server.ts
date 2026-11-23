import { existsSync } from 'node:fs';

import { z } from 'zod';

const envSchema = z.object({
    /** Base URL the web server uses to reach the API, e.g. http://localhost:3001 */
    API_URL: z.url().default('http://localhost:3001'),
    /**
     * The API's public health check URL, for the visitor's browser to call on the "starting up" page. Only
     * for hosts that put an idle API to sleep and wake it only for requests from outside (Render's free plan):
     * e.g. https://pesoprint-api.onrender.com/api/health. Leave unset where the API is always running.
     */
    API_WAKE_URL: z.url().optional(),
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
    /**
     * DSN of the Sentry project `pesoprint-web`. Both this server and visitors' browsers report errors to it.
     * Read by server.ts, which starts Sentry before the app; listed here so it's documented and validated.
     */
    SENTRY_DSN: z.url().optional(),
    /** Which environment errors come from in Sentry, e.g. `production` or `staging`. Defaults to NODE_ENV. */
    SENTRY_ENVIRONMENT: z.string().min(1).optional(),
    /**
     * Clerk's keys. Clerk's own code reads them (at runtime, so one image fits every environment); they're listed
     * here so production can require them and a key from the wrong place fails here, not on a visitor's sign-in.
     */
    VITE_CLERK_PUBLISHABLE_KEY: z
        .string()
        .startsWith('pk_', 'VITE_CLERK_PUBLISHABLE_KEY must start with pk_')
        .optional(),
    CLERK_SECRET_KEY: z.string().startsWith('sk_', 'CLERK_SECRET_KEY must start with sk_').optional(),
});

/**
 * Settings with a localhost default or optional elsewhere, but a production site is broken without them (wrong
 * links, no sign-in, shared download limits, no error reports). With NODE_ENV=production they must be set.
 */
const PRODUCTION_KEYS = [
    'API_URL',
    'SITE_URL',
    'INTERNAL_API_SECRET',
    'SENTRY_DSN',
    'VITE_CLERK_PUBLISHABLE_KEY',
    'CLERK_SECRET_KEY',
] as const;

export type WebEnv = z.infer<typeof envSchema>;

let cached: WebEnv | undefined;

/** Validates the settings in `source`. Exported for tests; the app uses getEnv(). */
export function parseEnv(source: NodeJS.ProcessEnv): WebEnv {
    // An empty value means "not set", as `KEY=` in a Docker env file gives an empty string, not a missing setting.
    const values = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ''));
    const missing = values.NODE_ENV === 'production' ? PRODUCTION_KEYS.filter((key) => values[key] === undefined) : [];
    const result = envSchema.safeParse(values);
    if (!result.success || missing.length > 0) {
        const problems = [
            ...(missing.length > 0 ? [`✖ Required in production, but not set: ${missing.join(', ')}`] : []),
            ...(result.success ? [] : [z.prettifyError(result.error)]),
        ];
        throw new Error(`Invalid environment variables:\n${problems.join('\n')}`);
    }
    return result.data;
}

/**
 * Validated server-side environment. The `.server` suffix keeps this out of the browser bundle. server.ts also
 * calls it once at startup, so a production server with missing settings stops there instead of failing pages.
 */
export function getEnv(): WebEnv {
    if (!cached) {
        // Local development: read apps/web/.env. In production the container provides the variables.
        if (process.env.NODE_ENV !== 'production' && existsSync('.env')) {
            process.loadEnvFile('.env');
        }
        cached = parseEnv(process.env);
    }
    return cached;
}
