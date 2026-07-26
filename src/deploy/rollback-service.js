import { readlink } from "node:fs/promises";

import { activateRelease } from "./activate.js";
import { readReleaseBuildInfo } from "./build-info.js";
import { appendDeployLog } from "./log.js";
import { listReleases } from "./release.js";
import { reloadPm2 } from "./pm2.js";
import { servicePaths } from "./paths.js";

/** Flip current to a named release or the previous one. */
export async function rollbackService(service, options = {}) {
    const { release: targetName, dryRun = false, logger = console } = options;
    const paths = servicePaths(service);
    const releases = await listReleases(paths);

    if (releases.length === 0) throw new Error("No releases to roll back to");

    let activeName = null;
    try {
        const target = await readlink(paths.current);
        activeName = target.split("/").pop();
    } catch {
        throw new Error("No active release (current symlink missing)");
    }

    let rollbackTarget;
    if (targetName) {
        rollbackTarget = releases.find((r) => r.name === targetName);
        if (!rollbackTarget) throw new Error(`Release not found: ${targetName}`);
    } else {
        rollbackTarget = releases.find((r) => r.name !== activeName);
        if (!rollbackTarget) throw new Error("No previous release to roll back to");
    }

    if (rollbackTarget.name === activeName) throw new Error(`Already on release ${activeName}`);

    logger.info(`rollback ${activeName} → ${rollbackTarget.name}`);
    const buildInfo = await readReleaseBuildInfo(service, rollbackTarget.path);
    if (buildInfo?.version) {
        logger.info(`rollback target: v${buildInfo.version} release=${buildInfo.release ?? rollbackTarget.name}`);
    }
    await activateRelease(rollbackTarget.path, paths, { dryRun, logger });
    const appName = service.pm2?.appName ?? null;
    const waitTimeoutMs = 65_000;
    await reloadPm2(paths, { dryRun, logger, appName, waitTimeoutMs });

    const summary = `rollback ${activeName} → ${rollbackTarget.name} dryRun=${dryRun}`;
    if (!dryRun) await appendDeployLog(paths.deployLog, summary);

    return { from: activeName, to: rollbackTarget.name, path: rollbackTarget.path };
}
