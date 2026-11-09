import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

import * as schema from './schema.ts';

export function createDatabase(connectionString: string) {
    const pool = new pg.Pool({ connectionString, max: 10 });
    const db = drizzle({ client: pool, schema });
    return { db, pool };
}

export type Database = ReturnType<typeof createDatabase>['db'];

/** Returns true if the database answers a trivial query. */
export async function pingDatabase(db: Database): Promise<boolean> {
    try {
        await db.execute(sql`select 1`);
        return true;
    } catch {
        return false;
    }
}

/** Applies all pending SQL migrations from the drizzle/ folder. */
export async function runMigrations(db: Database, migrationsFolder: string): Promise<void> {
    await migrate(db, { migrationsFolder });
}
