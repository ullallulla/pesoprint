import { pgEnum, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const userRole = pgEnum('user_role', ['customer', 'creator', 'admin']);

/**
 * Users mirrored from Clerk (via webhook). Clerk owns authentication;
 * this table lets orders, reviews and favourites reference a user.
 */
export const users = pgTable('users', {
    /** Clerk user id, e.g. `user_2abc...` */
    id: text('id').primaryKey(),
    email: text('email').notNull().unique(),
    displayName: text('display_name'),
    role: userRole('role').notNull().default('customer'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
        .notNull()
        .defaultNow()
        .$onUpdate(() => new Date()),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
