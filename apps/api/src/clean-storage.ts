import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { createDatabase } from './db/client.ts';
import { loadEnv } from './env.ts';
import { createStorageFromEnv } from './integrations/s3.ts';
import { describeDatabaseUrl } from './lib/database-url.ts';
import { deleteOrphans, findOrphans, ORPHAN_MIN_AGE_HOURS, StorageMismatchError } from './lib/storage-cleanup.ts';

/**
 * `vp run storage:cleanup` lists files in storage that no product uses: uploads that were never attached
 * to a product, and files left behind when deleting them failed. It only lists them; add `--delete` to
 * delete them. Files younger than a day are always kept (an upload may be in progress).
 *
 * Options:
 *   --env <file>   use these settings instead of apps/api/.env, e.g. `--env .env.staging`
 *   --delete       delete the files it lists
 */
const { values: options } = parseArgs({
    options: {
        // Not `--env-file`: Node takes that flag for itself before the script sees it.
        env: { type: 'string' },
        delete: { type: 'boolean', default: false },
    },
});

const env = loadEnv(process.env, {
    envFile: options.env === undefined ? undefined : resolve(options.env),
});
const storage = createStorageFromEnv(env);
if (!storage) {
    console.error('S3_* storage settings are not set, so there is no storage to clean up.');
    process.exit(1);
}
const { db, pool } = createDatabase(env.DATABASE_URL);

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

console.log(
    `Checking the ${env.S3_PUBLIC_BUCKET} and ${env.S3_PRIVATE_BUCKET} buckets against ${describeDatabaseUrl(env.DATABASE_URL)}.`,
);

try {
    const report = await findOrphans(db, storage);
    console.log(`The database uses ${report.referenced} files.`);

    if (report.missing.length > 0) {
        console.warn(`\n${report.missing.length} of them are missing from storage (broken images or downloads):`);
        for (const { bucket, key } of report.missing) console.warn(`  ${bucket}  ${key}`);
    }
    if (report.recent > 0) {
        console.log(
            `\nKept ${report.recent} unused files younger than ${ORPHAN_MIN_AGE_HOURS} hours (uploads may be in progress).`,
        );
    }

    const total = report.orphans.reduce((sum, object) => sum + object.sizeBytes, 0);
    if (report.orphans.length === 0) {
        console.log('\nNo unused files. Nothing to clean up.');
    } else {
        console.log(`\n${report.orphans.length} unused files (${mb(total)}):`);
        for (const object of report.orphans) {
            console.log(
                `  ${object.bucket.padEnd(7)}  ${object.key}  ${mb(object.sizeBytes)}  ${object.lastModified.toISOString().slice(0, 10)}`,
            );
        }

        if (!options.delete) {
            console.log('\nNothing was deleted. Run again with --delete to delete these files.');
        } else if (report.missing.length > 0) {
            // A healthy environment has no missing files. Missing ones can mean the database and the buckets
            // are from different environments, and then the "unused" files are the other environment's.
            console.error(
                '\nNot deleting anything while files are missing: check the list above first. If they are broken ' +
                    'references, remove those images or files in the admin, then run this again.',
            );
            process.exitCode = 1;
        } else {
            await deleteOrphans(storage, report.orphans);
            console.log(`\nDeleted ${report.orphans.length} files (${mb(total)}).`);
        }
    }
} catch (error) {
    console.error(error instanceof StorageMismatchError ? error.message : error);
    process.exitCode = 1;
} finally {
    await pool.end();
}
