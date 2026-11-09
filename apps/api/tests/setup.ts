import { existsSync } from 'node:fs';

// Load apps/api/.env so local runs can find TEST_DATABASE_URL. CI sets it directly.
if (existsSync('.env')) {
    process.loadEnvFile('.env');
}
