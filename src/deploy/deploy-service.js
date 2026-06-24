import { initServiceStructure } from "./init-structure.js";
import { appendDeployLog } from "./log.js";
import { pullRepo } from "./git.js";
import { createRelease } from "./release.js";
import { installDeps } from "./deps.js";
import { runReleaseTests } from "./test.js";
import { activateRelease } from "./activate.js";
import { pruneReleases } from "./prune.js";
import { reloadPm2 } from "./pm2.js";
import { enableNginxUpstream } from "./nginx.js";
import { syncEnv } from "./sync-env.js";
import { writeReleaseBuildInfo } from "./build-info.js";
import { servicePaths } from "./paths.js";

/** Full deploy: pull → env → release → deps → test → activate → prune → pm2 → nginx. */
export async function deployService(service, options = {}) {
    const {
        dryRun = false,
        skipPull = false,
        skipTests = false,
        skipNginx = false,
        logger = console,
    } = options;

    const paths = servicePaths(service);

    await initServiceStructure(service, { dryRun, logger });

    if (!skipPull) await pullRepo(service, { dryRun, logger });

    await syncEnv(service, { dryRun, logger });

    const { stamp, path: releasePath } = await createRelease(service, { dryRun, logger });
    await writeReleaseBuildInfo(service, releasePath, { stamp, dryRun, logger });
    await installDeps(service, releasePath, paths, { dryRun, logger });

    if (!skipTests) await runReleaseTests(service, releasePath, paths, { dryRun, logger });

    await activateRelease(releasePath, paths, { dryRun, logger });
    await pruneReleases(service, paths, { dryRun, logger });
    await reloadPm2(paths, { dryRun, logger });

    if (!skipNginx) await enableNginxUpstream(service, { dryRun, logger });

    const summary = `deploy complete stamp=${stamp} dryRun=${dryRun}`;
    logger.info(summary);
    if (!dryRun) await appendDeployLog(paths.deployLog, summary);

    return { stamp, releasePath };
}
