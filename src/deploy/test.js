import { symlink, unlink } from "node:fs/promises";
import { join } from "node:path";

import { npmInstallEnv, runShell } from "./run.js";

/**
 * Symlink shared/.env into the release and run the service's testCommand (a shell
 * one-liner, e.g. "npm run test:ci"). No-op when the service defines no command.
 */
export async function runReleaseTests(service, releasePath, paths, options = {}) {
    const { dryRun = false, logger = console } = options;

    if (!service.testCommand) {
        logger.info("no testCommand configured — skipping tests");
        return;
    }

    if (dryRun) {
        logger.info(`[dryRun] would run "${service.testCommand}" in ${releasePath}`);
        return;
    }

    const envLink = join(releasePath, ".env");
    try {
        await unlink(envLink);
    } catch {
        // no existing link
    }
    await symlink(paths.sharedEnv, envLink);

    logger.info(`running "${service.testCommand}" in ${releasePath}`);
    await runShell(service.testCommand, { cwd: releasePath, logger, env: npmInstallEnv() });
}
