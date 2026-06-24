import { createHash } from "node:crypto";
import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { readCurrentRelease } from "./release.js";
import { npmInstallEnv, run } from "./run.js";

async function pathExists(path) {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

async function lockfileHash(releasePath) {
    const lockPath = join(releasePath, "package-lock.json");
    try {
        const buf = await readFile(lockPath);
        return createHash("sha256").update(buf).digest("hex");
    } catch {
        return null; // no lockfile → can't fingerprint; always (re)install
    }
}

async function readHashFile(path) {
    try {
        return (await readFile(path, "utf8")).trim();
    } catch {
        return null;
    }
}

async function npmInstall(releasePath, hasLock, logger) {
    await rm(join(releasePath, "node_modules"), { recursive: true, force: true });
    const cmd = hasLock ? ["ci", "--include=dev"] : ["install", "--include=dev", "--no-audit", "--no-fund"];
    logger.info(`running npm ${cmd.join(" ")} in ${releasePath}`);
    await run("npm", cmd, { cwd: releasePath, logger, env: npmInstallEnv() });
}

/**
 * Install deps in the release. If the lockfile is unchanged from the active
 * release and its node_modules exists, copy it (fast path); otherwise npm ci.
 */
export async function installDeps(service, releasePath, paths, options = {}) {
    const { dryRun = false, logger = console } = options;

    if (dryRun) {
        logger.info(`[dryRun] would install deps in ${releasePath}`);
        return { hash: null, copied: false };
    }

    const hash = await lockfileHash(releasePath);
    const hasLock = hash !== null;
    const hashMarker = join(releasePath, ".deploy-package-lock.sha256");

    const currentPath = await readCurrentRelease(paths);
    let copied = false;

    if (hasLock && currentPath && (await pathExists(join(currentPath, "node_modules")))) {
        const currentHash = await readHashFile(join(currentPath, ".deploy-package-lock.sha256"));
        if (currentHash === hash) {
            logger.info("lockfile unchanged — copying node_modules from current release");
            await cp(join(currentPath, "node_modules"), join(releasePath, "node_modules"), {
                recursive: true,
                force: true,
            });
            copied = true;
        }
    }

    if (!copied) {
        await npmInstall(releasePath, hasLock, logger);
    }

    if (hasLock) {
        await writeFile(hashMarker, `${hash}\n`, "utf8");
        await mkdir(paths.shared, { recursive: true });
        await writeFile(paths.lockHashFile, `${hash}\n`, "utf8");
    }

    return { hash, copied };
}
