import { defineConfig } from 'vite-plus';

// Root Vite+ config: formatting, linting and task settings shared by every package.
// App-specific Vite settings live in each app's own vite.config.ts.
export default defineConfig({
    staged: {
        '*': 'vp check --fix',
    },
    fmt: {
        // Carried over from the old Pesotable .prettierrc
        singleQuote: true,
        jsxSingleQuote: true,
        printWidth: 120,
        tabWidth: 4,
        ignorePatterns: ['**/drizzle/meta/**', 'pnpm-lock.yaml'],
    },
    lint: {
        ignorePatterns: ['**/dist/**', '**/build/**', '**/.react-router/**'],
        jsPlugins: [{ name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' }],
        rules: {
            'vite-plus/prefer-vite-plus-imports': 'error',
            'no-console': ['error', { allow: ['warn', 'error'] }],
        },
        options: { typeAware: true, typeCheck: true },
        overrides: [
            {
                files: ['apps/web/**'],
                plugins: ['react', 'jsx-a11y'],
                env: { browser: true },
            },
            {
                files: ['apps/api/**'],
                env: { node: true },
                rules: {
                    // The API logs to stdout on purpose (startup, migrations).
                    'no-console': 'off',
                },
            },
            {
                files: ['**/*.test.ts', '**/*.test.tsx'],
                plugins: ['vitest'],
            },
        ],
    },
    test: {
        // `vp test` at the root runs every package as its own Vitest project, using that package's
        // vite.config.ts (path aliases, setup files). Without this, packages are tested with the root config.
        projects: ['apps/*', 'packages/*'],
        // API integration tests share one Postgres database. This option only works at the root,
        // so it applies to every project here (apps/api/vite.config.ts sets it for `vp test` inside the package).
        fileParallelism: false,
    },
    // package.json scripts are not cached (db:migrate, dev, etc. must always run).
    run: {
        cache: { scripts: false, tasks: true },
    },
});
