import { defineConfig } from 'vite-plus';

export default defineConfig({
    // `vp pack` (tsdown) bundles the API into dist/ for production.
    pack: {
        entry: ['src/index.ts', 'src/migrate.ts'],
        platform: 'node',
        format: 'esm',
        sourcemap: true,
        dts: false,
        deps: {
            // The shared package ships TypeScript source, so it must be bundled, not imported at runtime.
            alwaysBundle: ['@app/shared'],
        },
    },
    test: {
        setupFiles: ['tests/setup.ts'],
        // Database tests share one Postgres database, so run test files one at a time.
        fileParallelism: false,
    },
});
