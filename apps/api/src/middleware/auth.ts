import type { UserRole } from '@app/shared';
import { createMiddleware } from 'hono/factory';
import type { RequestIdVariables } from 'hono/request-id';

import type { AuthContext, VerifySessionToken } from '../lib/auth.ts';
import { sendError } from '../lib/errors.ts';

/** Context variables available in handlers behind `requireUser` / `requireRole`. */
export type AuthEnv = {
    Variables: RequestIdVariables & { auth: AuthContext };
};

function bearerToken(header: string | undefined): string | null {
    const match = header?.match(/^Bearer\s+(.+)$/i);
    return match?.[1] ?? null;
}

/**
 * Requires a valid Clerk session token in `Authorization: Bearer <token>`.
 * When `role` is given, the caller must also have that role.
 */
export function requireAuth(verify: VerifySessionToken, role?: UserRole) {
    return createMiddleware<AuthEnv>(async (c, next) => {
        const token = bearerToken(c.req.header('authorization'));
        if (!token) {
            return sendError(c, 401, 'unauthorized', 'Sign in required.');
        }

        let auth: AuthContext;
        try {
            auth = await verify(token);
        } catch {
            return sendError(c, 401, 'unauthorized', 'Your session is invalid or has expired.');
        }

        if (role && auth.role !== role) {
            return sendError(c, 403, 'forbidden', "You don't have access to this resource.");
        }

        c.set('auth', auth);
        await next();
        return undefined;
    });
}

export const requireUser = (verify: VerifySessionToken) => requireAuth(verify);
export const requireAdmin = (verify: VerifySessionToken) => requireAuth(verify, 'admin');

/** Context variables behind `optionalAuth`: `auth` is `null` for anonymous callers. */
export type OptionalAuthEnv = {
    Variables: RequestIdVariables & { auth: AuthContext | null };
};

/**
 * For routes open to everyone that do more for signed-in users (e.g. downloads: admins can download
 * drafts). No token means anonymous; a token that doesn't verify is still a 401, so an expired session
 * isn't silently treated as a visitor.
 */
export function optionalAuth(verify: VerifySessionToken) {
    return createMiddleware<OptionalAuthEnv>(async (c, next) => {
        const header = c.req.header('authorization');
        if (header === undefined) {
            c.set('auth', null);
            await next();
            return undefined;
        }
        const token = bearerToken(header);
        if (!token) {
            return sendError(c, 401, 'unauthorized', 'The Authorization header must be "Bearer <token>".');
        }
        try {
            c.set('auth', await verify(token));
        } catch {
            return sendError(c, 401, 'unauthorized', 'Your session is invalid or has expired.');
        }
        await next();
        return undefined;
    });
}
