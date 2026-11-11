import pg from 'pg';

/** Postgres error codes the services handle. https://www.postgresql.org/docs/current/errcodes-appendix.html */
export const PgErrorCode = {
    uniqueViolation: '23505',
    foreignKeyViolation: '23503',
    /** Raised by `ON DELETE RESTRICT`, instead of the generic foreign key violation. */
    restrictViolation: '23001',
    checkViolation: '23514',
} as const;

/** The Postgres error behind a failed query. Drizzle wraps it in a `DrizzleQueryError` as `cause`. */
function databaseError(error: unknown): pg.DatabaseError | null {
    if (error instanceof pg.DatabaseError) return error;
    if (error instanceof Error && error.cause instanceof pg.DatabaseError) return error.cause;
    return null;
}

/** True if the query failed with the given Postgres error code (and constraint, when given). */
export function isPgError(
    error: unknown,
    code: (typeof PgErrorCode)[keyof typeof PgErrorCode],
    constraint?: string,
): boolean {
    const dbError = databaseError(error);
    return dbError?.code === code && (constraint === undefined || dbError.constraint === constraint);
}
