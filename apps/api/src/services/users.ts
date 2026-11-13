import { count, eq } from 'drizzle-orm';

import type { Database } from '../db/client.ts';
import { users, type NewUser } from '../db/schema.ts';

export interface UsersService {
    count(): Promise<number>;
    /** Every user's Clerk id. */
    ids(): Promise<string[]>;
    /** Creates the user, or updates email, name and role if the Clerk id already exists. */
    upsert(user: NewUser): Promise<void>;
    remove(id: string): Promise<void>;
}

export function createUsersService(db: Database): UsersService {
    return {
        async count() {
            const [row] = await db.select({ value: count() }).from(users);
            return row?.value ?? 0;
        },

        async ids() {
            const rows = await db.select({ id: users.id }).from(users);
            return rows.map((row) => row.id);
        },

        async upsert(user) {
            await db
                .insert(users)
                .values(user)
                .onConflictDoUpdate({
                    target: users.id,
                    set: {
                        email: user.email,
                        displayName: user.displayName ?? null,
                        role: user.role ?? 'customer',
                        updatedAt: new Date(),
                    },
                });
        },

        async remove(id) {
            await db.delete(users).where(eq(users.id, id));
        },
    };
}
