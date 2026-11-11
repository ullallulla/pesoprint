import { apiErrorSchema } from '@app/shared';
import { z } from '@hono/zod-openapi';

/** An OpenAPI response whose body is the shared `ApiError`. */
export const errorResponse = (description: string) => ({
    description,
    content: { 'application/json': { schema: apiErrorSchema } },
});

/** Responses every admin-only route can return. */
export const adminAuthResponses = {
    401: errorResponse('Missing, invalid or expired session token.'),
    403: errorResponse('The caller is not an admin.'),
};

/** `{id}` path parameter. A value that isn't a UUID gets a 400 before the handler runs. */
export const idParams = z.object({ id: z.uuid().openapi({ param: { name: 'id', in: 'path' } }) });
