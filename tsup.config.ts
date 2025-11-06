import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    args: "src/args.ts",
    screen: "src/screen/index.ts",
    params: "src/params.ts",
    errors: "src/errors.ts",
    logger: "src/logger/index.ts",
    filestore: "src/filestore.ts"
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
