import { access } from "node:fs/promises";

import { servicePaths } from "./paths.js";
import { run } from "./run.js";

async function pathExists(path) {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

export async function cloneRepo(service, options = {}) {
    const { dryRun = false, logger = console } = options;
    const paths = servicePaths(service);

    if (await pathExists(paths.repo)) {
        throw new Error(`Repo already exists at ${paths.repo} — use git pull instead`);
    }
    if (dryRun) {
        logger.info(`[dryRun] would git clone ${service.repoUrl} ${paths.repo}`);
        return;
    }

    await run("git", ["clone", service.repoUrl, paths.repo], { logger });
    logger.info(`cloned ${service.repoUrl} → ${paths.repo}`);
}

export async function pullRepo(service, options = {}) {
    const { dryRun = false, logger = console } = options;
    const paths = servicePaths(service);

    if (!(await pathExists(paths.repo))) {
        throw new Error(`Repo missing at ${paths.repo} — run provision first`);
    }
    if (dryRun) {
        logger.info(`[dryRun] would git -C ${paths.repo} pull --ff-only`);
        return;
    }

    await run("git", ["-C", paths.repo, "pull", "--ff-only"], { logger });
    logger.info(`pulled ${paths.repo}`);
}
