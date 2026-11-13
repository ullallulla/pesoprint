import type { UserJSON } from '@clerk/backend';
import { expect, test } from 'vite-plus/test';

import { syncUsers, type ListClerkUsers } from '../src/lib/user-sync.ts';
import { createFakeUsers } from './helpers.ts';

function clerkUser(id: string, email: string | null, metadata: Record<string, unknown> = {}): UserJSON {
    return {
        id,
        first_name: null,
        last_name: null,
        username: id,
        primary_email_address_id: email ? 'idn_1' : null,
        email_addresses: email ? [{ id: 'idn_1', email_address: email }] : [],
        public_metadata: metadata,
    } as unknown as UserJSON;
}

/** Clerk's user list, served in pages like the real API. Records which pages were asked for. */
function clerkList(all: UserJSON[]) {
    const requested: { offset: number; limit: number }[] = [];
    const list: ListClerkUsers = async (page) => {
        requested.push(page);
        return { users: all.slice(page.offset, page.offset + page.limit), totalCount: all.length };
    };
    return { list, requested };
}

test('copies every Clerk user across pages, with their role', async () => {
    const users = createFakeUsers();
    const all = Array.from({ length: 5 }, (_, i) => clerkUser(`user_${i}`, `u${i}@example.com`));
    all[0] = clerkUser('user_0', 'admin@example.com', { role: 'admin' });
    const { list, requested } = clerkList(all);

    const result = await syncUsers(users, list, { pageSize: 2 });

    expect(result.synced).toBe(5);
    expect(requested).toEqual([
        { offset: 0, limit: 2 },
        { offset: 2, limit: 2 },
        { offset: 4, limit: 2 },
    ]);
    expect(users.rows.get('user_0')).toMatchObject({ email: 'admin@example.com', role: 'admin' });
    expect(users.rows.size).toBe(5);
});

test('updates users that already exist', async () => {
    const users = createFakeUsers();
    await users.upsert({ id: 'user_1', email: 'old@example.com', role: 'customer' });

    await syncUsers(users, clerkList([clerkUser('user_1', 'new@example.com', { role: 'creator' })]).list);

    expect(users.rows.get('user_1')).toMatchObject({ email: 'new@example.com', role: 'creator' });
});

test('skips Clerk users without an email address, like the webhook does', async () => {
    const users = createFakeUsers();
    const result = await syncUsers(users, clerkList([clerkUser('user_phone', null)]).list);
    expect(result).toMatchObject({ synced: 0, withoutEmail: ['user_phone'] });
    expect(users.rows.size).toBe(0);
});

test('users gone from Clerk are only listed, unless pruning', async () => {
    const users = createFakeUsers();
    await users.upsert({ id: 'user_gone', email: 'gone@example.com' });
    const { list } = clerkList([clerkUser('user_1', 'a@example.com')]);

    const listed = await syncUsers(users, list);
    expect(listed).toMatchObject({ missingInClerk: ['user_gone'], removed: [] });
    expect(users.rows.has('user_gone')).toBe(true);

    const pruned = await syncUsers(users, list, { prune: true });
    expect(pruned).toMatchObject({ missingInClerk: ['user_gone'], removed: ['user_gone'] });
    expect(users.rows.has('user_gone')).toBe(false);
});

test("the seed's sample creator is not in Clerk on purpose, so it's left alone", async () => {
    const users = createFakeUsers();
    await users.upsert({ id: 'user_seed_sample_studio', email: 'sample-studio@example.com' });

    const result = await syncUsers(users, clerkList([]).list, { prune: true, localOnly: ['user_seed_sample_studio'] });

    expect(result).toMatchObject({ missingInClerk: [], removed: [] });
    expect(users.rows.has('user_seed_sample_studio')).toBe(true);
});

test('one user that fails to save or delete does not stop the others', async () => {
    const users = createFakeUsers();
    await users.upsert({ id: 'user_creator', email: 'creator@example.com' });
    users.upsert = async (user) => {
        if (user.id === 'user_dup') throw new Error('Failed query', { cause: new Error('duplicate key value') });
        users.rows.set(user.id, user);
    };
    users.remove = async () => {
        throw new Error('violates foreign key constraint "products_creator_id_users_id_fk"');
    };

    const result = await syncUsers(
        users,
        clerkList([clerkUser('user_dup', 'dup@example.com'), clerkUser('user_ok', 'ok@example.com')]).list,
        { prune: true },
    );

    expect(result.synced).toBe(1);
    expect(result.failed).toEqual([
        { id: 'user_dup', reason: 'duplicate key value' },
        { id: 'user_creator', reason: 'violates foreign key constraint "products_creator_id_users_id_fk"' },
    ]);
});
