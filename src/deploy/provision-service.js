import { access } from "node:fs/promises";

import { bootstrapHost } from "./bootstrap-host.js";
import { initServiceStructure } from "./init-structure.js";
import { cloneRepo, pullRepo } from "./git.js";
import { deployService } from "./deploy-service.js";
import { deployNotice } from "./log.js";
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
        deployNotice(logger, "Bootstrap host (pm2, deploy key, operator shell)");
        await bootstrapHost(service, { deployKey, dryRun, logger });
    }

    deployNotice(logger, `Prepare ${service.name} directories`);
    await initServiceStructure(service, { dryRun, logger });
    const paths = servicePaths(service);

    if (await pathExists(paths.repo)) {
        deployNotice(logger, "Pull existing repository");
        logger.info(`repo exists at ${paths.repo} — pulling`);
        await pullRepo(service, { dryRun, logger });
    } else {
        deployNotice(logger, "Clone repository");
        await cloneRepo(service, { dryRun, logger });
    }

    deployNotice(logger, "Sync environment");
    await syncEnv(service, { dryRun, logger });

    if (deploy) {
        deployNotice(logger, "Run first deploy");
        await deployService(service, { dryRun, logger, skipPull: true });
    } else {
        deployNotice(logger, "Provision complete (deploy skipped)");
        logger.info("provision complete (deploy skipped)");
    }
}
