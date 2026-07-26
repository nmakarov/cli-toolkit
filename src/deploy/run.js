import { spawn } from "node:child_process";

/** npm omits devDependencies when NODE_ENV=production — unset it for ci + tests. */
export function npmEnv(baseEnv = process.env) {
    const env = { ...baseEnv };
    delete env.NODE_ENV;
    return env;
}

/** Env for npm ci/install so devDependencies are always installed. */
export function npmInstallEnv(baseEnv = process.env) {
    return {
        ...npmEnv(baseEnv),
        NPM_CONFIG_PRODUCTION: "false",
        npm_config_production: "false",
    };
}

/** Run a command with inherited stdio. Rejects on non-zero exit. */
export function run(cmd, args, options = {}) {
    const { cwd, env, logger } = options;

    return new Promise((resolve, reject) => {
        logger?.info?.(`$ ${cmd} ${args.join(" ")}${cwd ? `  (cwd=${cwd})` : ""}`);
        const child = spawn(cmd, args, {
            cwd,
            env: env ?? process.env,
            stdio: "inherit",
        });
        child.on("error", reject);
        child.on("close", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`${cmd} exited with code ${code}`));
        });
    });
}

/** Run a shell one-liner via bash -lc. */
export function runShell(command, options = {}) {
    return run("bash", ["-lc", command], options);
}

/**
 * Run a command capturing stdout/stderr (for `pm2 jlist`, etc.).
 * Rejects on non-zero exit unless `allowFail` is set.
 *
 * @returns {Promise<{ stdout: string, stderr: string, code: number|null }>}
 */
export function runCapture(cmd, args, options = {}) {
    const { cwd, env, logger, allowFail = false } = options;

    return new Promise((resolve, reject) => {
        logger?.info?.(`$ ${cmd} ${args.join(" ")}${cwd ? `  (cwd=${cwd})` : ""}`);
        const child = spawn(cmd, args, {
            cwd,
            env: env ?? process.env,
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout?.on("data", (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr?.on("data", (chunk) => {
            stderr += chunk.toString();
        });
        child.on("error", reject);
        child.on("close", (code) => {
            if (code === 0 || allowFail) resolve({ stdout, stderr, code });
            else reject(new Error(`${cmd} exited with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`));
        });
    });
}
