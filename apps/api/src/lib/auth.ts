import { userRoleSchema, type UserRole } from '@app/shared';
import { verifyToken } from '@clerk/backend';

/** The signed-in caller, as established by the auth middleware. */
export interface AuthContext {
    userId: string;
    sessionId: string | undefined;
    role: UserRole;
}

/** Verifies a Clerk session token. Resolves to the caller, or throws if the token is invalid or expired. */
export type VerifySessionToken = (token: string) => Promise<AuthContext>;

/**
 * Reads the role from the `metadata` session claim. That claim must be added in the Clerk Dashboard
 * (Sessions → Customize session token): `{ "metadata": "{{user.public_metadata}}" }`.
 * Missing or unknown roles fall back to `customer`.
 */
export function roleFromClaims(claims: Record<string, unknown>): UserRole {
    const metadata = claims.metadata;
    if (typeof metadata !== 'object' || metadata === null || !('role' in metadata)) {
        return 'customer';
    }
    const parsed = userRoleSchema.safeParse(metadata.role);
    return parsed.success ? parsed.data : 'customer';
}

export function createClerkTokenVerifier(options: {
    secretKey: string;
    authorizedParties: string[];
}): VerifySessionToken {
    return async (token) => {
        // Throws on a bad signature, expiry, or a token issued for another origin.
        const payload = await verifyToken(token, {
            secretKey: options.secretKey,
            authorizedParties: options.authorizedParties,
        });
        return {
            userId: payload.sub,
            sessionId: payload.sid,
            role: roleFromClaims(payload as unknown as Record<string, unknown>),
        };
    };
}
