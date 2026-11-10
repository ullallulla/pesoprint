import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

const envSchema = z.object({
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
});

export type Env = z.infer<typeof envSchema>;

/**
 * Loads apps/api/.env (if present) and validates the environment.
 * Fails fast with a readable message instead of crashing later on a missing variable.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
    // src/env.ts and the bundled dist/*.mjs both sit one level below the package root.
    const envFile = fileURLToPath(new URL('../.env', import.meta.url));
    if (source === process.env && existsSync(envFile)) {
        process.loadEnvFile(envFile);
    }

    const result = envSchema.safeParse(source);
    if (!result.success) {
        throw new Error(`Invalid environment variables:\n${z.prettifyError(result.error)}`);
    }
    return result.data;
}
