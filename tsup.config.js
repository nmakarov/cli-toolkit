import { defineConfig } from "tsup";
import { esmDepsPlugin } from "./tsup-plugin-esm-deps.js";

export default defineConfig({
    entry: {
        index: "src/index.js",
        args: "src/args/index.js",
        screen: "src/screen/index.js",
        params: "src/params/index.js",
        errors: "src/errors.js",
        logger: "src/logger/index.js",
        filedatabase: "src/filedatabase/index.js",
        "http-client": "src/http-client/index.js",
        "http-client2": "src/http-client2/index.js",
        "mock-server": "src/mock-server/index.js",
        db: "src/db/index.js",
        init: "src/init/index.js",
        tasks: "src/tasks/index.js",
        "cli-runner": "src/scripts/cli-runner.js",
        utils: "src/utils/index.js"
    },
    format: ["esm", "cjs"],
    dts: false,
    clean: true,
    splitting: false,
    sourcemap: true,
    minify: false,
    target: "node20",
    // Mark ESM-only packages as external so they're not bundled
    // They'll be loaded via dynamic import in CJS builds by the plugin
    external: ["ink", "react"],
    plugins: [esmDepsPlugin()]
});
