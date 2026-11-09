import { fileURLToPath } from 'node:url';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vite-plus/test';

import { createDatabase, pingDatabase, runMigrations } from '../src/db/client.ts';
import { users } from '../src/db/schema.ts';

const url = process.env.TEST_DATABASE_URL;

// Runs against a real Postgres. Start it with `vp run db:up` (local) — CI provides one as a service.
describe.skipIf(!url)('database (integration)', () => {
    const { db, pool } = createDatabase(url ?? '');

    beforeAll(async () => {
        await runMigrations(db, fileURLToPath(new URL('../drizzle', import.meta.url)));
        await db.delete(users);
    });

    afterAll(async () => {
        await db.delete(users);
        await pool.end();
    });

    test('pingDatabase reports the database as up', async () => {
        expect(await pingDatabase(db)).toBe(true);
    });

    test('inserts a user with default role and timestamps', async () => {
        const [created] = await db
            .insert(users)
            .values({ id: 'user_test_1', email: 'buyer@example.com', displayName: 'Test Buyer' })
            .returning();

        expect(created).toMatchObject({ id: 'user_test_1', role: 'customer' });
        expect(created?.createdAt).toBeInstanceOf(Date);

        const found = await db.select().from(users).where(eq(users.id, 'user_test_1'));
        expect(found).toHaveLength(1);
    });

    test('rejects a duplicate email', async () => {
        await expect(db.insert(users).values({ id: 'user_test_2', email: 'buyer@example.com' })).rejects.toMatchObject({
            cause: { code: '23505' }, // Postgres unique_violation
        });
    });
});
