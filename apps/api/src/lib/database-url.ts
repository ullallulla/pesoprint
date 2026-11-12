/** Host names that mean "this computer" (Docker Compose publishes Postgres on localhost). */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** True for a database on this computer. Unparsable URLs count as remote, to be safe. */
export function isLocalDatabaseUrl(url: string): boolean {
    try {
        const { hostname } = new URL(url);
        return LOCAL_HOSTS.has(hostname) || hostname.endsWith('.localhost');
    } catch {
        return false;
    }
}

/** `postgres://user:secret@host:5432/db?…` → `host:5432/db`: safe to print, no credentials or options. */
export function describeDatabaseUrl(url: string): string {
    try {
        const { host, pathname } = new URL(url);
        return `${host}${pathname}`;
    } catch {
        return '(unreadable database URL)';
    }
}
