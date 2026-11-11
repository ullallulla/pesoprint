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

/** A problem with one field (or one part of a resource, e.g. `images`). */
export const apiErrorIssueSchema = z.object({
    path: z.string(),
    message: z.string(),
});
export type ApiErrorIssue = z.infer<typeof apiErrorIssueSchema>;

/** Every error response from the API has this shape. */
export const apiErrorSchema = z
    .object({
        error: z.object({
            code: apiErrorCodeSchema,
            message: z.string(),
            /**
             * Field-level problems. Present for `validation_failed`, and for a `conflict` that lists
             * what has to change first (e.g. why a product can't be published yet).
             */
            issues: z.array(apiErrorIssueSchema).optional(),
            requestId: z.string().optional(),
        }),
    })
    .meta({ id: 'ApiError' });
export type ApiError = z.infer<typeof apiErrorSchema>;
