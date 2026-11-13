import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { createClerkClient } from '@clerk/backend';

import { createDatabase } from './db/client.ts';
import { SEED_CREATOR } from './db/seed.ts';
import { loadEnv } from './env.ts';
import { describeDatabaseUrl } from './lib/database-url.ts';
import { syncUsers } from './lib/user-sync.ts';
import { createUsersService } from './services/users.ts';

/**
 * `vp run users:sync` copies every Clerk user into the database from apps/api/.env, as the webhook
 * does for each change. Use it for accounts made before the webhook was set up, or while it was down.
 * The Clerk key and the database come from the same settings file, so one environment is never
 * synced into another.
 *
 * Options:
 *   --env <file>   use these settings instead of apps/api/.env, e.g. `--env .env.staging`
 *   --prune        also delete users that no longer exist in Clerk (otherwise they're only listed)
 */
const { values: options } = parseArgs({
    options: {
        // Not `--env-file`: Node takes that flag for itself before the script sees it.
        env: { type: 'string' },
        prune: { type: 'boolean', default: false },
    },
});

const env = loadEnv(process.env, {
    envFile: options.env === undefined ? undefined : resolve(options.env),
});
const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
const { db, pool } = createDatabase(env.DATABASE_URL);

console.log(`Syncing Clerk users into ${describeDatabaseUrl(env.DATABASE_URL)}.`);

try {
    const result = await syncUsers(
        createUsersService(db),
        async ({ offset, limit }) => {
            const page = await clerk.users.getUserList({ offset, limit, orderBy: 'created_at' });
            return {
                // `raw` is Clerk's JSON for the user, the same shape the webhook receives.
                users: page.data.flatMap((user) => (user.raw ? [user.raw] : [])),
                totalCount: page.totalCount,
            };
        },
        // The seed's sample products belong to a user that was never in Clerk.
        { prune: options.prune, localOnly: [SEED_CREATOR.id] },
    );

    console.log(`Synced ${result.synced} users.`);
    if (result.withoutEmail.length > 0) {
        console.log(
            `Skipped ${result.withoutEmail.length} without an email address: ${result.withoutEmail.join(', ')}`,
        );
    }
    if (result.missingInClerk.length > 0) {
        console.log(
            options.prune
                ? `Deleted ${result.removed.length} users that no longer exist in Clerk: ${result.removed.join(', ') || '-'}`
                : `${result.missingInClerk.length} users here no longer exist in Clerk (run with --prune to delete them): ${result.missingInClerk.join(', ')}`,
        );
    }
    for (const { id, reason } of result.failed) {
        console.error(`Failed: ${id}: ${reason}`);
    }
    if (result.failed.length > 0) process.exitCode = 1;
} catch (error) {
    console.error('Sync failed:', error);
    process.exitCode = 1;
} finally {
    await pool.end();
}
