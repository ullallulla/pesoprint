import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

/** S3-compatible file storage (Cloudflare R2). All or none: without them, the upload endpoints answer 503. */
const STORAGE_KEYS = [
    'S3_ENDPOINT',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
    'S3_PUBLIC_BUCKET',
    'S3_PRIVATE_BUCKET',
    'PUBLIC_ASSETS_URL',
] as const;

/**
 * Optional elsewhere, but a production shop is broken without them (checkout, webhooks, emails, uploads, rate
 * limits or error reports), so with NODE_ENV=production the API refuses to start until they're set. WEB_ORIGINS
 * has a localhost default for development, so it must be set explicitly too.
 */
const PRODUCTION_KEYS = [
    'WEB_ORIGINS',
    'CLERK_WEBHOOK_SIGNING_SECRET',
    'INTERNAL_API_SECRET',
    'IP_HASH_SECRET',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'RESEND_API_KEY',
    'SENTRY_DSN',
    ...STORAGE_KEYS,
] as const;

const databaseUrlSchema = z.url({ protocol: /^postgres(ql)?$/, error: 'DATABASE_URL must be a postgres:// URL' });

const envSchema = z
    .object({
        NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
        PORT: z.coerce.number().int().positive().default(3001),
        DATABASE_URL: databaseUrlSchema,
        /**
         * `true` lets NODE_ENV=production start without the PRODUCTION_KEYS. Only for the restore test
         * (deploy/restore.sh), which runs the production image against a restored database with no live keys;
         * never in a real environment. Staying in production mode keeps queued order emails queued.
         */
        SKIP_PRODUCTION_SETTINGS_CHECK: z
            .enum(['true', 'false'])
            .default('false')
            .transform((value) => value === 'true'),
        LOG_REQUESTS: z
            .enum(['true', 'false'])
            .default('true')
            .transform((value) => value === 'true'),
        /** Clerk secret key, used to verify session tokens sent by the web app. */
        CLERK_SECRET_KEY: z.string().startsWith('sk_', 'CLERK_SECRET_KEY must start with sk_'),
        /** Signing secret of the Clerk webhook endpoint. Without it, POST /api/webhooks/clerk answers 503. */
        CLERK_WEBHOOK_SIGNING_SECRET: z.string().startsWith('whsec_').optional(),
        /**
         * Comma-separated origins of the web app. Session tokens issued for any other origin are rejected
         * (Clerk "authorized parties" check).
         */
        WEB_ORIGINS: z
            .string()
            .default('http://localhost:5173')
            .transform((value) =>
                value
                    .split(',')
                    .map((origin) => origin.trim())
                    .filter(Boolean),
            )
            .refine((origins) => origins.length > 0, 'WEB_ORIGINS must list at least one origin'),
        /**
         * Shared with the web app (same value on both). Lets the web server tell the API a visitor's IP for
         * download rate limits. Optional: without it the API uses the IP its own proxy reports.
         */
        INTERNAL_API_SECRET: z.string().min(32, 'INTERNAL_API_SECRET must be at least 32 characters').optional(),
        /** Key for hashing visitors' IPs (`download_events.ip_hash`). Optional: a random key per start is used without it. */
        IP_HASH_SECRET: z.string().min(32, 'IP_HASH_SECRET must be at least 32 characters').optional(),
        /**
         * Stripe secret key (Dashboard → Developers → API keys): `sk_test_…` until launch. Without it,
         * checkout answers 503. Stripe sends buyers back to the first of WEB_ORIGINS.
         */
        STRIPE_SECRET_KEY: z
            .string()
            .regex(/^(sk|rk)_(test|live)_/, 'STRIPE_SECRET_KEY must start with sk_test_ or sk_live_')
            .optional(),
        /** Signing secret of the Stripe webhook endpoint (or of `stripe listen`). Without it, the webhook answers 503. */
        STRIPE_WEBHOOK_SECRET: z
            .string()
            .startsWith('whsec_', 'STRIPE_WEBHOOK_SECRET must start with whsec_')
            .optional(),
        /**
         * Resend API key (`re_…`, "Sending access") for order emails. Without it, emails are printed to the console
         * in development, and in production they wait in the outbox until it's set.
         */
        RESEND_API_KEY: z.string().startsWith('re_', 'RESEND_API_KEY must start with re_').optional(),
        /** Who order emails are from. Its domain must be verified in Resend. */
        EMAIL_FROM: z.string().min(3).default('Pesoprint <orders@pesoprint.allulab.eu>'),
        /** Where replies to order emails go, e.g. a support inbox. Without it, replies go to EMAIL_FROM. */
        EMAIL_REPLY_TO: z.email().optional(),
        /** Put before every email subject, e.g. `[Staging] `, so emails from test environments stand out. */
        EMAIL_SUBJECT_PREFIX: z.string().default(''),
        /**
         * Where errors are reported: the DSN of the Sentry project `pesoprint-api` (Project settings → Client Keys).
         * Without it, nothing is sent to Sentry.
         */
        SENTRY_DSN: z.url().optional(),
        /** Which environment errors come from in Sentry, e.g. `production` or `staging`. Defaults to NODE_ENV. */
        SENTRY_ENVIRONMENT: z.string().min(1).optional(),
        /** e.g. `https://<account id>.r2.cloudflarestorage.com`. */
        S3_ENDPOINT: z.url().optional(),
        /** `auto` for R2. */
        S3_REGION: z.string().default('auto'),
        S3_ACCESS_KEY_ID: z.string().min(1).optional(),
        S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
        /** Images and 3D previews; must allow public reads. */
        S3_PUBLIC_BUCKET: z.string().min(1).optional(),
        /** Model downloads; must not be public. */
        S3_PRIVATE_BUCKET: z.string().min(1).optional(),
        /** Where the public bucket is served from: a custom domain or the bucket's r2.dev URL. */
        PUBLIC_ASSETS_URL: z.url().optional(),
    })
    .superRefine((env, ctx) => {
        const set = STORAGE_KEYS.filter((key) => env[key] !== undefined);
        if (set.length > 0 && set.length < STORAGE_KEYS.length) {
            const missing = STORAGE_KEYS.filter((key) => env[key] === undefined);
            ctx.addIssue({
                code: 'custom',
                path: [missing[0]!],
                message: `File storage is partly configured. Also set: ${missing.join(', ')} (or remove the S3_* settings).`,
            });
        }
    });

export type Env = z.infer<typeof envSchema>;

/**
 * Loads apps/api/.env (if present) and validates the environment.
 * Fails fast with a readable message instead of crashing later on a missing variable.
 *
 * `envFile` loads that file instead of apps/api/.env (it must exist), e.g. `.env.staging` for the
 * seed script, so settings from two environments are never mixed.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env, { envFile }: { envFile?: string } = {}): Env {
    const values = readValues(source, envFile);
    const checkProduction = values.NODE_ENV === 'production' && values.SKIP_PRODUCTION_SETTINGS_CHECK !== 'true';
    const missing = checkProduction ? PRODUCTION_KEYS.filter((key) => values[key] === undefined) : [];
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
 * Only DATABASE_URL, for the migrations: they need nothing else, so they run wherever the database is reachable
 * (e.g. the restore test) without the API's other settings.
 */
export function loadDatabaseUrl(source: NodeJS.ProcessEnv = process.env): string {
    const result = databaseUrlSchema.safeParse(readValues(source).DATABASE_URL);
    if (!result.success) {
        throw new Error(`Invalid environment variables:\n${z.prettifyError(result.error)}`);
    }
    return result.data;
}

/** Loads the settings file into process.env (when reading process.env), and drops empty values. */
function readValues(source: NodeJS.ProcessEnv, envFile?: string): Record<string, string | undefined> {
    if (envFile !== undefined && !existsSync(envFile)) {
        throw new Error(`The settings file ${envFile} does not exist.`);
    }
    // src/env.ts and the bundled dist/*.mjs both sit one level below the package root.
    const file = envFile ?? fileURLToPath(new URL('../.env', import.meta.url));
    if (source === process.env && existsSync(file)) {
        process.loadEnvFile(file);
    }
    // An empty value means "not set", as `KEY=` in a Docker env file gives an empty string, not a missing setting.
    return Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ''));
}
