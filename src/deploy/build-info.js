import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { readCurrentRelease } from "./release.js";
import { servicePaths } from "./paths.js";

const execFileAsync = promisify(execFile);

/** Bump semver patch (0.1.0 → 0.1.1). */
export function bumpPatchVersion(version) {
    const parts = String(version).trim().split(".");
    const major = Number.parseInt(parts[0], 10) || 0;
    const minor = Number.parseInt(parts[1], 10) || 0;
    const patch = Number.parseInt(parts[2], 10) || 0;
    return `${major}.${minor}.${patch + 1}`;
}

async function readJson(path) {
    try {
        return JSON.parse(await readFile(path, "utf8"));
    } catch {
        return null;
    }
}

async function gitShortCommit(repoPath) {
    try {
        const { stdout } = await execFileAsync("git", ["-C", repoPath, "rev-parse", "--short", "HEAD"], {
            encoding: "utf8",
        });
        return stdout.trim() || null;
    } catch {
        return null;
    }
}

/**
 * Next semver: bump patch from the **currently active** release's build-info,
 * else seed from package.json. Each release carries its own build-info.json so a
 * rollback restores that release's label.
 */
export async function resolveNextVersion(service, paths, pkgPath) {
    const pkg = (await readJson(pkgPath)) ?? {};
    const baseVersion = pkg.version || "0.1.0";

    const currentPath = await readCurrentRelease(paths);
    if (currentPath) {
        const active = await readJson(join(currentPath, service.buildInfoPath));
        if (active?.version) return bumpPatchVersion(active.version);
    }
    return baseVersion;
}

/** Read build-info from a release directory (for rollback logs / status). */
export async function readReleaseBuildInfo(service, releasePath) {
    return readJson(join(releasePath, service.buildInfoPath));
}

/** Write build-info.json into the new release directory. */
export async function writeReleaseBuildInfo(service, releasePath, { stamp, dryRun = false, logger = console }) {
    const paths = servicePaths(service);
    const pkgPath = join(paths.repoRun, "package.json");

    const version = await resolveNextVersion(service, paths, pkgPath);
    const gitCommit = await gitShortCommit(paths.repo);

    const buildInfo = {
        version,
        release: stamp,
        deployedAt: new Date().toISOString(),
        gitCommit,
        service: service.name,
    };

    const dest = join(releasePath, service.buildInfoPath);

    if (dryRun) {
        logger.info(`[dryRun] would write ${dest} (${JSON.stringify(buildInfo)})`);
        return buildInfo;
    }

    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, `${JSON.stringify(buildInfo, null, 2)}\n`, { mode: 0o644 });

    const gitSuffix = gitCommit ? ` git=${gitCommit}` : "";
    logger.info(`build info: v${version} release=${stamp}${gitSuffix}`);
    return buildInfo;
}
