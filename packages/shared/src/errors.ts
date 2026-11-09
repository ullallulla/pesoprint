import { z } from 'zod';

/** Machine-readable error codes returned by the API. */
export const apiErrorCodeSchema = z.enum([
    'bad_request',
    'validation_failed',
    'unauthorized',
    'forbidden',
    'not_found',
    'conflict',
    'rate_limited',
    'internal_error',
]);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

/** Every error response from the API has this shape. */
export const apiErrorSchema = z
    .object({
        error: z.object({
            code: apiErrorCodeSchema,
            message: z.string(),
            /** Field-level problems, present when code is `validation_failed`. */
            issues: z
                .array(
                    z.object({
                        path: z.string(),
                        message: z.string(),
                    }),
                )
                .optional(),
            requestId: z.string().optional(),
        }),
    })
    .meta({ id: 'ApiError' });
export type ApiError = z.infer<typeof apiErrorSchema>;
