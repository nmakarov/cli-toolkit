import { runShell, runCapture } from "./run.js";

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse `pm2 jlist` and return the process entry for `appName`, or null.
 *
 * @param {string} appName
 * @param {{ logger?: { info?: Function, warn?: Function } }} [options]
 * @returns {Promise<object|null>}
 */
export async function getPm2Process(appName, options = {}) {
    const { logger } = options;
    const { stdout } = await runCapture("bash", ["-lc", "pm2 jlist"], { logger });
    let list;
    try {
        list = JSON.parse(stdout || "[]");
    } catch (err) {
        throw new Error(`pm2 jlist: invalid JSON (${err?.message ?? err})`);
    }
    if (!Array.isArray(list)) return null;
    return list.find((p) => p?.name === appName) ?? null;
}

/**
 * Poll pm2 until `predicate(proc)` is true (proc may be null if missing), or timeout.
 *
 * @param {string} appName
 * @param {(proc: object|null) => boolean} predicate
 * @param {{ timeoutMs?: number, pollMs?: number, dryRun?: boolean, logger?: object, label?: string }} [options]
 */
export async function waitPm2(appName, predicate, options = {}) {
    const {
        timeoutMs = 65_000,
        pollMs = 500,
        dryRun = false,
        logger = console,
        label = "condition",
    } = options;

    if (dryRun) {
        logger.info?.(`[dryRun] would wait pm2 ${appName} for ${label}`);
        return null;
    }

    const deadline = Date.now() + timeoutMs;
    let lastStatus = "(unknown)";
    while (Date.now() < deadline) {
        const proc = await getPm2Process(appName, { logger });
        lastStatus = proc?.pm2_env?.status ?? "(missing)";
        if (predicate(proc)) return proc;
        await sleep(pollMs);
    }
    throw new Error(
        `pm2 wait timed out after ${timeoutMs}ms for ${appName} (${label}); last status=${lastStatus}`
    );
}

/** `pm2 startOrReload <ecosystem> --update-env` — rolling restart (default deploy path). */
export async function reloadPm2(paths, options = {}) {
    const { dryRun = false, logger = console, appName = null, waitTimeoutMs = 65_000 } = options;

    if (dryRun) {
        logger.info(`[dryRun] would pm2 startOrReload ${paths.ecosystem} --update-env`);
        return;
    }

    await runShell(`pm2 startOrReload "${paths.ecosystem}" --update-env`, { logger });
    logger.info("pm2 reloaded");

    if (appName) {
        await waitPm2(
            appName,
            (proc) => proc?.pm2_env?.status === "online",
            { timeoutMs: waitTimeoutMs, logger, label: "online after reload" }
        );
        logger.info(`pm2 ${appName} online`);
    }
}

/** `pm2 stop <app>` and wait until status is stopped (or process missing). */
export async function stopPm2(appName, options = {}) {
    const { dryRun = false, logger = console, waitTimeoutMs = 65_000 } = options;

    if (dryRun) {
        logger.info(`[dryRun] would pm2 stop ${appName}`);
        return;
    }

    const before = await getPm2Process(appName, { logger });
    if (!before) {
        logger.info(`pm2 ${appName}: not present (already stopped)`);
        return;
    }
    if (before.pm2_env?.status === "stopped") {
        logger.info(`pm2 ${appName}: already stopped`);
        return;
    }

    await runShell(`pm2 stop "${appName}"`, { logger });
    await waitPm2(
        appName,
        (proc) => !proc || proc.pm2_env?.status === "stopped",
        { timeoutMs: waitTimeoutMs, logger, label: "stopped" }
    );
    logger.info(`pm2 ${appName} stopped`);
}

/** `pm2 start <ecosystem> --update-env` and wait until online. */
export async function startPm2(paths, options = {}) {
    const { dryRun = false, logger = console, appName = null, waitTimeoutMs = 65_000 } = options;

    if (dryRun) {
        logger.info(`[dryRun] would pm2 start ${paths.ecosystem} --update-env`);
        return;
    }

    await runShell(`pm2 start "${paths.ecosystem}" --update-env`, { logger });
    logger.info("pm2 started");

    if (appName) {
        await waitPm2(
            appName,
            (proc) => proc?.pm2_env?.status === "online",
            { timeoutMs: waitTimeoutMs, logger, label: "online after start" }
        );
        logger.info(`pm2 ${appName} online`);
    }
}
