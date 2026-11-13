import type { UserJSON } from '@clerk/backend';

import type { UsersService } from '../services/users.ts';
import { userFromClerk } from './clerk-user.ts';

/** One page of Clerk's user list. */
export type ListClerkUsers = (page: { offset: number; limit: number }) => Promise<{
    users: UserJSON[];
    totalCount: number;
}>;

export interface UserSyncResult {
    /** Users created or updated from Clerk. */
    synced: number;
    /** Clerk users without an email address, which the shop can't serve (same rule as the webhook). */
    withoutEmail: string[];
    /** Users in our database that no longer exist in Clerk. */
    missingInClerk: string[];
    /** Of those, the ones deleted here (only with `prune`). */
    removed: string[];
    /** Users that couldn't be saved or deleted, and why. */
    failed: { id: string; reason: string }[];
}

const reasonOf = (error: unknown) =>
    error instanceof Error && error.cause instanceof Error
        ? error.cause.message
        : error instanceof Error
          ? error.message
          : String(error);

/**
 * Copies every Clerk user into the `users` table, as the webhook does for each change. For accounts
 * created before the webhook existed, or changes made while it was down.
 *
 * With `prune`, users that are gone from Clerk are deleted here too. A user who created products can't
 * be deleted (the products need their creator); those end up in `failed`.
 */
export async function syncUsers(
    users: UsersService,
    listClerkUsers: ListClerkUsers,
    {
        prune = false,
        pageSize = 100,
        localOnly = [],
    }: {
        prune?: boolean;
        pageSize?: number;
        /** Users that only exist here on purpose (the seed's sample creator): never missing, never pruned. */
        localOnly?: readonly string[];
    } = {},
): Promise<UserSyncResult> {
    const result: UserSyncResult = { synced: 0, withoutEmail: [], missingInClerk: [], removed: [], failed: [] };
    const inClerk = new Set<string>();

    for (let offset = 0; ; offset += pageSize) {
        const page = await listClerkUsers({ offset, limit: pageSize });
        for (const clerkUser of page.users) {
            inClerk.add(clerkUser.id);
            const user = userFromClerk(clerkUser);
            if (!user) {
                result.withoutEmail.push(clerkUser.id);
                continue;
            }
            try {
                await users.upsert(user);
                result.synced++;
            } catch (error) {
                // e.g. two accounts with the same email: the rest still sync.
                result.failed.push({ id: user.id, reason: reasonOf(error) });
            }
        }
        if (page.users.length < pageSize || offset + pageSize >= page.totalCount) break;
    }

    result.missingInClerk = (await users.ids()).filter((id) => !inClerk.has(id) && !localOnly.includes(id)).toSorted();
    if (prune) {
        for (const id of result.missingInClerk) {
            try {
                await users.remove(id);
                result.removed.push(id);
            } catch (error) {
                result.failed.push({ id, reason: reasonOf(error) });
            }
        }
    }
    return result;
}
