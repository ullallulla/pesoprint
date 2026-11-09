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
