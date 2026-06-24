import { symlink, unlink } from "node:fs/promises";
import { join } from "node:path";

/** Point current → release and link shared/.env inside the release. */
export async function activateRelease(releasePath, paths, options = {}) {
    const { dryRun = false, logger = console } = options;

    if (dryRun) {
        logger.info(`[dryRun] would activate ${releasePath} → ${paths.current}`);
        return;
    }

    try {
        await unlink(paths.current);
    } catch {
        // first deploy
    }
    await symlink(releasePath, paths.current);

    const envLink = join(releasePath, ".env");
    try {
        await unlink(envLink);
    } catch {
        // ok
    }
    await symlink(paths.sharedEnv, envLink);

    logger.info(`active release: ${releasePath}`);
}
