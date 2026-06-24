import { runShell } from "./run.js";

export async function reloadPm2(paths, options = {}) {
    const { dryRun = false, logger = console } = options;

    if (dryRun) {
        logger.info(`[dryRun] would pm2 startOrReload ${paths.ecosystem} --update-env`);
        return;
    }

    await runShell(`pm2 startOrReload "${paths.ecosystem}" --update-env`, { logger });
    logger.info("pm2 reloaded");
}
