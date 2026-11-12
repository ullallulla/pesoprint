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

const envSchema = z
    .object({
        NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
        PORT: z.coerce.number().int().positive().default(3001),
        DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: 'DATABASE_URL must be a postgres:// URL' }),
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
            ),
        /**
         * Shared with the web app (same value on both). Lets the web server tell the API a visitor's IP for
         * download rate limits. Optional: without it the API uses the IP its own proxy reports.
         */
        INTERNAL_API_SECRET: z.string().min(32, 'INTERNAL_API_SECRET must be at least 32 characters').optional(),
        /** Key for hashing visitors' IPs (`download_events.ip_hash`). Optional: a random key per start is used without it. */
        IP_HASH_SECRET: z.string().min(32, 'IP_HASH_SECRET must be at least 32 characters').optional(),
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
    if (envFile !== undefined && !existsSync(envFile)) {
        throw new Error(`The settings file ${envFile} does not exist.`);
    }
    // src/env.ts and the bundled dist/*.mjs both sit one level below the package root.
    const file = envFile ?? fileURLToPath(new URL('../.env', import.meta.url));
    if (source === process.env && existsSync(file)) {
        process.loadEnvFile(file);
    }

    const result = envSchema.safeParse(source);
    if (!result.success) {
        throw new Error(`Invalid environment variables:\n${z.prettifyError(result.error)}`);
    }
    return result.data;
}
