import { z } from 'zod';

export const healthStatusSchema = z.enum(['ok', 'degraded']);
export type HealthStatus = z.infer<typeof healthStatusSchema>;

export const healthResponseSchema = z
    .object({
        status: healthStatusSchema,
        database: z.enum(['up', 'down']),
        version: z.string(),
        uptimeSeconds: z.number().int().nonnegative(),
    })
    .meta({ id: 'HealthResponse' });
export type HealthResponse = z.infer<typeof healthResponseSchema>;
