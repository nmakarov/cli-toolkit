import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    args: "src/args.ts",
    screen: "src/screen/index.ts",
    params: "src/params.ts",
    errors: "src/errors.ts",
    logger: "src/logger/index.ts",
    filedatabase: "src/filedatabase.ts",
    "http-client": "src/http-client.ts",
    "mock-server": "src/mock-server.ts",
    db: "src/db.ts",
    init: "src/init.ts"
  },
    format: ["esm", "cjs"],
    dts: false,
    clean: true,
    splitting: false,
    sourcemap: true,
    minify: false,
    target: "node20",
    jsx: "transform",
    loader: {
        ".ts": "tsx"
    }
});
