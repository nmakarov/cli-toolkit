import { readlink } from "node:fs/promises";

import { initServiceStructure } from "./init-structure.js";
import { appendDeployLog } from "./log.js";
import { pullRepo } from "./git.js";
import { createRelease } from "./release.js";
import { installDeps } from "./deps.js";
import { runReleaseTests } from "./test.js";
import { activateRelease } from "./activate.js";
import { pruneReleases } from "./prune.js";
import { reloadPm2, stopPm2, startPm2 } from "./pm2.js";
import { enableNginxUpstream } from "./nginx.js";
import { syncEnv } from "./sync-env.js";
import { writeReleaseBuildInfo } from "./build-info.js";
import { servicePaths } from "./paths.js";

/**
 * Resolve pm2 kill_timeout (ms). Prefer manifest `pm2.killTimeout`, else
 * stopAllowance seconds × 1000 + 5s buffer, else 65s.
 */
function resolveKillTimeoutMs(service) {
    const explicit = Number(service.pm2?.killTimeout);
    if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit);
    const stopSec = Number(service.pm2?.stopAllowance);
    if (Number.isFinite(stopSec) && stopSec > 0) return Math.floor(stopSec * 1000) + 5000;
    return 65_000;
}

/**
 * Full deploy: pull → env → release → deps → test → activate → pm2 → prune → nginx.
 *
 * Default (**rolling**): keep the process running while the new release is built and
 * `current` is flipped; then `pm2 startOrReload` (SIGTERM + kill_timeout) so the
 * runner drains and pm2 brings it back on the new code. Previous release is not
 * pruned until after that restart.
 *
 * **`--stopFirst`**: `pm2 stop` + wait → activate/prune → `pm2 start`. Use when a
 * runner is wedged and will not honor graceful stop.
 */
export async function deployService(service, options = {}) {
    const {
        dryRun = false,
        skipPull = false,
        skipTests = false,
        skipNginx = false,
        stopFirst = false,
        logger = console,
    } = options;

    const paths = servicePaths(service);
    const appName = service.pm2.appName;
    const killTimeoutMs = resolveKillTimeoutMs(service);
    const waitTimeoutMs = killTimeoutMs + 10_000;

    await initServiceStructure(service, { dryRun, logger });

    if (!skipPull) await pullRepo(service, { dryRun, logger });

    await syncEnv(service, { dryRun, logger });

    const { stamp, path: releasePath } = await createRelease(service, { dryRun, logger });
    await writeReleaseBuildInfo(service, releasePath, { stamp, dryRun, logger });
    await installDeps(service, releasePath, paths, { dryRun, logger });

    if (!skipTests) await runReleaseTests(service, releasePath, paths, { dryRun, logger });

    let previousReleaseName = null;
    try {
        const prev = await readlink(paths.current);
        previousReleaseName = prev.split("/").pop() || null;
    } catch {
        // first deploy
    }

    if (stopFirst) {
        logger.info(`deploy mode=stopFirst app=${appName} killTimeoutMs=${killTimeoutMs}`);
        await stopPm2(appName, { dryRun, logger, waitTimeoutMs });
        await activateRelease(releasePath, paths, { dryRun, logger });
        await pruneReleases(service, paths, { dryRun, logger });
        await startPm2(paths, { dryRun, logger, appName, waitTimeoutMs });
    } else {
        logger.info(
            `deploy mode=rolling app=${appName} killTimeoutMs=${killTimeoutMs}` +
                (previousReleaseName ? ` previous=${previousReleaseName}` : "")
        );
        await activateRelease(releasePath, paths, { dryRun, logger });
        // Restart into new `current` before pruning the previous tree (still in use by the old process).
        await reloadPm2(paths, { dryRun, logger, appName, waitTimeoutMs });
        await pruneReleases(service, paths, { dryRun, logger });
    }

    if (!skipNginx) await enableNginxUpstream(service, { dryRun, logger });

    const summary = `deploy complete stamp=${stamp} mode=${stopFirst ? "stopFirst" : "rolling"} dryRun=${dryRun}`;
    logger.info(summary);
    if (!dryRun) await appendDeployLog(paths.deployLog, summary);

    return { stamp, releasePath, mode: stopFirst ? "stopFirst" : "rolling" };
}
