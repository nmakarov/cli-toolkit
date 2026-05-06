import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["src/**/tests/**/*.test.js"],
        exclude: ["legacy/**/*", "node_modules/**/*"],
        globals: true,
        coverage: {
            provider: "v8",
            reporter: ["text", "html", "json"],
            reportsDirectory: "./coverage",
            include: ["src/**/*.js"],
            exclude: [
                "src/**/*.test.js",
                "src/**/*.spec.js",
                "legacy/**/*"
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
