import js from "@eslint/js";

const nodeGlobals = {
    process: "readonly",
    console: "readonly",
    Buffer: "readonly",
    __dirname: "readonly",
    __filename: "readonly",
    global: "readonly",
    globalThis: "readonly",
    module: "readonly",
    require: "readonly",
    exports: "readonly",
    setTimeout: "readonly",
    clearTimeout: "readonly",
    setInterval: "readonly",
    clearInterval: "readonly",
    setImmediate: "readonly",
    clearImmediate: "readonly",
    queueMicrotask: "readonly",
    URL: "readonly",
    URLSearchParams: "readonly",
    fetch: "readonly",
    Request: "readonly",
    Response: "readonly",
    Headers: "readonly",
    AbortController: "readonly",
    AbortSignal: "readonly",
    DOMException: "readonly",
    TextEncoder: "readonly",
    TextDecoder: "readonly",
    performance: "readonly",
    structuredClone: "readonly"
};

const vitestGlobals = {
    describe: "readonly",
    it: "readonly",
    test: "readonly",
    expect: "readonly",
    beforeAll: "readonly",
    afterAll: "readonly",
    beforeEach: "readonly",
    afterEach: "readonly",
    vi: "readonly"
};

export default [
    js.configs.recommended,
    {
        files: ["**/*.js", "**/*.mjs"],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            globals: nodeGlobals
        },
        rules: {
            "no-unused-vars": ["error", {
                argsIgnorePattern: "^_",
                varsIgnorePattern: "^_",
                caughtErrors: "none"
            }],
            "no-console": "off",
            "prefer-const": "error",
            "no-var": "error",
            "quotes": ["error", "double", { avoidEscape: true, allowTemplateLiterals: true }],
            "indent": ["error", 4, { SwitchCase: 1 }]
        }
    },
    {
        files: ["**/tests/**/*.js", "**/*.test.js", "**/*.spec.js"],
        languageOptions: {
            globals: { ...nodeGlobals, ...vitestGlobals }
        }
    },
    {
        ignores: [
            "dist/**",
            "node_modules/**",
            "coverage/**",
            "*.config.js",
            "legacy/**"
        ]
    }
];
