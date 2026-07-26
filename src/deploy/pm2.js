import { runShell, runCapture } from "./run.js";

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True if `pid` still exists (same host). */
export function isPidAlive(pid) {
    const n = Number(pid);
    if (!Number.isFinite(n) || n <= 0) return false;
    try {
        process.kill(n, 0);
        return true;
    } catch {
        return false;
    }
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

/**
 * True when pm2 reports the app online on a *new* pid (old process fully gone).
 * Avoids treating a not-yet-dead pre-reload process as a successful restart.
 */
export function isFreshOnline(proc, oldPid) {
    if (proc?.pm2_env?.status !== "online") return false;
    const pid = Number(proc.pid);
    if (!Number.isFinite(pid) || pid <= 0) return false;
    if (oldPid != null) {
        if (pid === oldPid) return false;
        if (isPidAlive(oldPid)) return false;
    }
    return true;
}

/** `pm2 startOrReload <ecosystem> --update-env` — rolling restart (default deploy path). */
export async function reloadPm2(paths, options = {}) {
    const { dryRun = false, logger = console, appName = null, waitTimeoutMs = 65_000 } = options;

    if (dryRun) {
        logger.info(`[dryRun] would pm2 startOrReload ${paths.ecosystem} --update-env`);
        return;
    }

    let oldPid = null;
    if (appName) {
        const before = await getPm2Process(appName, { logger });
        const n = Number(before?.pid);
        if (Number.isFinite(n) && n > 0 && before?.pm2_env?.status === "online") {
            oldPid = n;
            logger.info(`pm2 ${appName}: reloading (old pid=${oldPid})`);
        }
    }

    // Prefix ENV on the pm2 CLI itself: --update-env copies the invoking shell's
    // environment into the app, which otherwise may omit / stale-out ecosystem env.
    await runShell(
        `ENV=production NODE_ENV=production pm2 startOrReload "${paths.ecosystem}" --update-env`,
        { logger }
    );
    logger.info("pm2 reloaded");

    if (appName) {
        const proc = await waitPm2(
            appName,
            (p) => isFreshOnline(p, oldPid),
            {
                timeoutMs: waitTimeoutMs,
                logger,
                label: oldPid
                    ? `online on new pid (old ${oldPid} gone)`
                    : "online after reload",
            }
        );
        logger.info(`pm2 ${appName} online pid=${proc?.pid ?? "?"}`);
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

    const oldPid = Number(before.pid);
    await runShell(`pm2 stop "${appName}"`, { logger });
    await waitPm2(
        appName,
        (proc) => {
            if (proc && proc.pm2_env?.status !== "stopped") return false;
            if (Number.isFinite(oldPid) && oldPid > 0 && isPidAlive(oldPid)) return false;
            return true;
        },
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

    await runShell(
        `ENV=production NODE_ENV=production pm2 start "${paths.ecosystem}" --update-env`,
        { logger }
    );
    logger.info("pm2 started");

    if (appName) {
        const proc = await waitPm2(
            appName,
            (p) => isFreshOnline(p, null),
            { timeoutMs: waitTimeoutMs, logger, label: "online after start" }
        );
        logger.info(`pm2 ${appName} online pid=${proc?.pid ?? "?"}`);
    }
}
