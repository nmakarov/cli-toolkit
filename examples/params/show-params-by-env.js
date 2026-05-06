#!/usr/bin/env node
/**
 * Params + Args: environment-specific resolution (`env`, suffixed CLI flags, suffixed env vars, `.env.<env>`).
 *
 * How it works (see `src/args/index.ts`): after parsing argv, `Args` sets `this.env` from `--env` (or `NODE_ENV`
 * for the `env` key). Lookups then try, in order: overrides → CLI `key_<env>` → CLI `key` → config files →
 * `KEY_<ENV>` → `KEY` → defaults.
 *
 * Run from package root (`subprojects/cli-toolkit`):
 *
 * --- Baseline: implicit env=local, plain CLI ---
 *   npx tsx examples/params/show-params-by-env.ts --apiUrl=http://localhost:4000
 *   Expect: env=local, apiUrl from CLI, dryRun default false.
 *
 * --- Generic process.env (no suffix): used when no env-specific override exists ---
 *   API_URL=https://api.generic.example npx tsx examples/params/show-params-by-env.ts --env=staging
 *   Expect: env=staging, apiUrl from env (API_URL), source "env".
 *
 * --- Env-specific process.env wins over generic ---
 *   API_URL=https://api.generic.example API_URL_STAGING=https://api.staging.example npx tsx examples/params/show-params-by-env.ts --env=staging
 *   Expect: apiUrl=https://api.staging.example (API_URL_STAGING beats API_URL).
 *
 * --- Env-specific CLI flag wins over env vars ---
 *   API_URL_STAGING=https://from.env npx tsx examples/params/show-params-by-env.ts --env=staging --apiUrl_staging=https://from.cli
 *   Expect: apiUrl from CLI (highest precedence among these layers).
 *
 * --- Boolean via suffixed env var ---
 *   DRY_RUN_STAGING=true npx tsx examples/params/show-params-by-env.ts --env=staging
 *   Expect: dryRun=true from env.
 *
 * --- Inspect all figured params (including logger, stopAllowance, etc.) ---
 *   npx tsx examples/params/show-params-by-env.ts --env=staging --stopAfter=init
 *
 * --- Optional: put vars in `.env.staging` in cwd (loaded after `env` is known) ---
 *   # file .env.staging contains: API_URL=https://from.dotenv
 *   npx tsx examples/params/show-params-by-env.ts --env=staging
 *   Expect: apiUrl from dotenv (still behind CLI / overrides if those are set).
 */

import { init } from "../../src/init/index.js";
import chalk from "chalk";

const defs = {
    env: "string default local",
    apiUrl: "string",
    dryRun: "boolean default false",
};

function formatValue(value) {
    if (value === undefined || value === null) return chalk.dim("(unset)");
    if (typeof value === "boolean") return value ? "true" : "false";
    return String(value);
}

const flow = async (context) => {
    const resolved = context.params.getAll(defs);
    const figured = context.params.getAllFigured();

    context.logger.info?.(chalk.yellow("Params by env — resolved values for this script"));
    context.logger.info?.(chalk.dim("─".repeat(56)));

    for (const key of Object.keys(defs)) {
        const entry = figured[key];
        const src = entry?.source ?? "?";
        const hi = src === "default" ? chalk.dim : chalk.green;
        context.logger.info?.(
            `  ${chalk.bold(key)}: ${formatValue(resolved[key])}  ${chalk.dim("(source:")} ${hi(src)}${chalk.dim(")")}`
        );
    }

    context.logger.info?.("");
    context.logger.info?.(
        chalk.dim(
            `Active Args env suffix: _${String(context.args.get("env") ?? "local").toLowerCase()} (e.g. --apiUrl_staging=..., API_URL_STAGING)`
        )
    );
};

void init(flow);
