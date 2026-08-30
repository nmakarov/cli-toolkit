import { defineConfig } from "vitest/config";

/**
 * Not in the 80% per-file gate. CLI entry, legacy shims, live-host
 * orchestration, process runners, barrel files, and large I/O modules that
 * already have their own dedicated CI suites.
 */
export const COVERAGE_EXCLUDE = [
    "src/**/*.test.js",
    "src/**/*.spec.js",
    "src/**/tests/**",
    "legacy/**/*",
    "src/scripts/cli-runner.js",
    "src/http-client2/legacy.js",
    "src/http-client2/index.js",
    "src/http-client/index.js",
    "src/index.js",
    "src/utils/index.js",
    "src/screen/index.js",
    "src/screen/esm-loader.js",
    "src/screen/scrollable-text.js",
    "src/screen/list-components.js",
    "src/deploy/bootstrap-host.js",
    "src/deploy/nginx.js",
    "src/deploy/ssh-remote.js",
    "src/deploy/provision-service.js",
    "src/deploy/deploy-service.js",
    "src/deploy/rollback-service.js",
    "src/deploy/deps.js",
    "src/tasks/taskScriptRunner.js",
    "src/tasks/registryMaintenance.js",
    "src/tasks/index.js",
    "src/tasks/taskLogs.js",
    "src/db/index.js",
    "src/db/ensure.js",
    "src/filedatabase/index.js",
    "src/init/index.js",
    "src/mock-server/index.js",
    "src/params/index.js",
    "src/params/custom-types.js",
    "src/args/index.js",
];

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
            exclude: COVERAGE_EXCLUDE,
            thresholds: {
                perFile: true,
                lines: 80,
                functions: 80,
                statements: 80,
            },
        },
    },
});
