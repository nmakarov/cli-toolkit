import { access } from "node:fs/promises";

import { bootstrapHost } from "./bootstrap-host.js";
import { initServiceStructure } from "./init-structure.js";
import { cloneRepo, pullRepo } from "./git.js";
import { deployService } from "./deploy-service.js";
import { syncEnv } from "./sync-env.js";
import { servicePaths } from "./paths.js";

async function pathExists(path) {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

/** First-time setup: optional bootstrap, init dirs, clone/pull, sync .env, first deploy. */
export async function provisionService(service, options = {}) {
    const {
        dryRun = false,
        deploy = true,
        skipBootstrap = true,
        deployKey,
        logger = console,
    } = options;

    if (!skipBootstrap) {
        await bootstrapHost(service, { deployKey, dryRun, logger });
    }

    await initServiceStructure(service, { dryRun, logger });
    const paths = servicePaths(service);

    if (await pathExists(paths.repo)) {
        logger.info(`repo exists at ${paths.repo} — pulling`);
        await pullRepo(service, { dryRun, logger });
    } else {
        await cloneRepo(service, { dryRun, logger });
    }

    await syncEnv(service, { dryRun, logger });

    if (deploy) {
        await deployService(service, { dryRun, logger, skipPull: true });
    } else {
        logger.info("provision complete (deploy skipped)");
    }
}
