import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/**/tests/**/*.test.ts'],
        exclude: ['legacy/**/*', 'node_modules/**/*'],
        globals: true,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'json'],
            reportsDirectory: './coverage',
            include: ['src/**/*.ts'],
            exclude: [
                'src/**/*.d.ts',
                'src/**/*.test.ts',
                'src/**/*.spec.ts',
                'legacy/**/*'
            ],
            thresholds: {
                global: {
                    branches: 70,
                    functions: 70,
                    lines: 70,
                    statements: 70
                }
            }
        }
    },
});

