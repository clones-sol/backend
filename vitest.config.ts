import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        globals: true,
        setupFiles: ['./tests/setup.ts'],
        include: ['**/*.test.ts'],
        exclude: ['**/node_modules/**', '**/build/**'],
        testTimeout: 10000,
        hookTimeout: 10000,
    },
    resolve: {
        alias: {
            // Handle .js imports in .ts files
            '^(\\.{1,2}/.*)\\.js$': '$1',
        },
    },
}); 