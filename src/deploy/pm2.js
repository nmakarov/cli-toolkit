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
 * Parse `pm2 jlist` stdout. When the daemon was not running, pm2 prints
 * "[PM2] Spawning PM2 daemon…" on stdout before the JSON array.
 *
 * @param {string} stdout
 * @returns {unknown[]}
 */
export function parsePm2Jlist(stdout) {
    const raw = String(stdout ?? "");
    // Drop "[PM2] Spawning…" banners (stdout when the daemon was not running).
    const text = raw
        .split("\n")
        .filter((line) => !line.startsWith("[PM2]"))
        .join("\n")
        .trim();
    if (!text) return [];
    try {
        const parsed = JSON.parse(text);
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        throw new Error(`pm2 jlist: invalid JSON (${err?.message ?? err})`);
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
    // Warm the daemon so spawn banners do not race the next jlist (best-effort).
    await runCapture("bash", ["-lc", "pm2 ping >/dev/null 2>&1 || true"], { logger }).catch(() => {});
    const { stdout } = await runCapture("bash", ["-lc", "pm2 jlist"], { logger });
    let list;
    try {
        list = parsePm2Jlist(stdout);
    } catch (err) {
        throw new Error(`pm2 jlist: invalid JSON (${err?.message ?? err})`);
    }
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

/**
 * Remove app from pm2 (SIGINT + kill_timeout drain) and wait until gone.
 * No-op if the app is not present.
 */
async function deletePm2App(appName, options = {}) {
    const { dryRun = false, logger = console, waitTimeoutMs = 65_000, oldPid = null } = options;

    if (dryRun) {
        logger.info(`[dryRun] would pm2 delete ${appName}`);
        return;
    }

    const before = await getPm2Process(appName, { logger });
    if (!before) {
        logger.info(`pm2 ${appName}: not present (skip delete)`);
        return;
    }

    await runShell(`pm2 delete "${appName}"`, { logger });
    await waitPm2(
        appName,
        (proc) => {
            if (proc) return false;
            if (oldPid != null && isPidAlive(oldPid)) return false;
            return true;
        },
        { timeoutMs: waitTimeoutMs, logger, label: "deleted (process gone)" }
    );
    logger.info(`pm2 ${appName} deleted`);
}

/** Fresh `pm2 start <ecosystem> --update-env` with production ENV on the CLI. */
async function startFromEcosystem(paths, options = {}) {
    const { dryRun = false, logger = console } = options;

    if (dryRun) {
        logger.info(`[dryRun] would pm2 start ${paths.ecosystem} --update-env`);
        return;
    }

    // Prefix ENV on the pm2 CLI: --update-env copies the invoking shell env.
    await runShell(
        `ENV=production NODE_ENV=production pm2 start "${paths.ecosystem}" --update-env`,
        { logger }
    );
    logger.info("pm2 started from ecosystem");
}

/**
 * Rolling restart: `pm2 delete` then `pm2 start <ecosystem> --update-env`.
 *
 * Prefer delete+start over `startOrReload --update-env`: reload can leave a first
 * spawn with a stale/wrong ENV (e.g. S3 profile=local) and does not refresh
 * immutable fields like `script` / `node_args`. Delete honors kill_timeout so the
 * old process can drain, then start applies the full ecosystem.
 */
export async function reloadPm2(paths, options = {}) {
    const { dryRun = false, logger = console, appName = null, waitTimeoutMs = 65_000 } = options;

    if (dryRun) {
        logger.info(
            `[dryRun] would pm2 delete${appName ? ` ${appName}` : ""} + start ${paths.ecosystem} --update-env`
        );
        return;
    }

    let oldPid = null;
    if (appName) {
        const before = await getPm2Process(appName, { logger });
        const n = Number(before?.pid);
        if (Number.isFinite(n) && n > 0 && before?.pm2_env?.status === "online") {
            oldPid = n;
            logger.info(`pm2 ${appName}: recreate (old pid=${oldPid})`);
        }
        await deletePm2App(appName, { dryRun, logger, waitTimeoutMs, oldPid });
    } else {
        logger.warn?.(
            "reloadPm2: appName missing; starting ecosystem without delete " +
                "(pass appName so script/env always recreate cleanly)"
        );
    }

    await startFromEcosystem(paths, { dryRun, logger });

    if (appName) {
        const proc = await waitPm2(
            appName,
            (p) => isFreshOnline(p, oldPid),
            {
                timeoutMs: waitTimeoutMs,
                logger,
                label: oldPid
                    ? `online on new pid (old ${oldPid} gone)`
                    : "online after recreate",
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

/**
 * `pm2 start <ecosystem> --update-env` after deleting any existing registration
 * so immutable fields (script, node_args) and env always come from the ecosystem.
 */
export async function startPm2(paths, options = {}) {
    const { dryRun = false, logger = console, appName = null, waitTimeoutMs = 65_000 } = options;

    if (dryRun) {
        logger.info(
            `[dryRun] would pm2 delete${appName ? ` ${appName}` : ""} + start ${paths.ecosystem} --update-env`
        );
        return;
    }

    if (appName) {
        // stopFirst leaves a stopped registration; delete so start is a full recreate.
        await deletePm2App(appName, { dryRun, logger, waitTimeoutMs });
    }

    await startFromEcosystem(paths, { dryRun, logger });

    if (appName) {
        const proc = await waitPm2(
            appName,
            (p) => isFreshOnline(p, null),
            { timeoutMs: waitTimeoutMs, logger, label: "online after start" }
        );
        logger.info(`pm2 ${appName} online pid=${proc?.pid ?? "?"}`);
    }
}
