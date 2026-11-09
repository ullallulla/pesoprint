import { OpenAPIHono } from '@hono/zod-openapi';
import type { RequestIdVariables } from 'hono/request-id';

import { sendError } from './errors.ts';

export type AppEnv = {
    Variables: RequestIdVariables;
};

/**
 * Creates a router whose request validation failures all use the shared error format.
 * Every feature router should be created with this instead of `new OpenAPIHono()`.
 */
export function createRouter() {
    return new OpenAPIHono<AppEnv>({
        defaultHook: (result, c) => {
            if (!result.success) {
                return sendError(
                    c,
                    400,
                    'validation_failed',
                    'The request is invalid.',
                    result.error.issues.map((issue) => ({
                        path: issue.path.join('.'),
                        message: issue.message,
                    })),
                );
            }
            return undefined;
        },
    });
}
