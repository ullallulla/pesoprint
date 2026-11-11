import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Load apps/api/.env so local runs can find TEST_DATABASE_URL, whether `vp test` runs in apps/api
// or from the repo root. Variables that are already set (e.g. by CI) win.
const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
}
