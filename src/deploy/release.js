import { cp, mkdir, readlink, readdir, stat } from "node:fs/promises";
import { join, dirname as pathDirname, sep } from "node:path";

import { releaseDir, releaseStamp, servicePaths } from "./paths.js";

const SKIP_TOP = new Set(["node_modules", ".git"]);

function shouldCopyEntry(srcPath) {
    const parts = srcPath.split(sep);
    if (parts.some((p) => p === "node_modules" || p === ".git")) return false;
    const top = parts.at(-1);
    if (parts.length === 1 && SKIP_TOP.has(top)) return false;
    return true;
}

/** Copy the run dir into releases/<stamp>/ (excluding node_modules and .git). */
export async function createRelease(service, options = {}) {
    const { stamp = releaseStamp(), dryRun = false, logger = console } = options;
    const paths = servicePaths(service);
    const dest = releaseDir(paths.releases, stamp);

    if (dryRun) {
        logger.info(`[dryRun] would copy ${paths.repoRun} → ${dest}`);
        return { stamp, path: dest };
    }

    await mkdir(paths.releases, { recursive: true });
    await cp(paths.repoRun, dest, {
        recursive: true,
        filter: (src) => shouldCopyEntry(src),
    });

    logger.info(`release ${stamp} created at ${dest}`);
    return { stamp, path: dest };
}

/** Resolve current release path if symlink exists. */
export async function readCurrentRelease(paths) {
    try {
        const target = await readlink(paths.current);
        return target.startsWith("/") ? target : join(pathDirname(paths.current), target);
    } catch {
        return null;
    }
}

export async function listReleases(paths) {
    let names;
    try {
        names = await readdir(paths.releases);
    } catch {
        return [];
    }

    const entries = [];
    for (const name of names) {
        const full = releaseDir(paths.releases, name);
        const s = await stat(full);
        if (s.isDirectory()) entries.push({ name, path: full, mtime: s.mtime });
    }

    entries.sort((a, b) => b.name.localeCompare(a.name));
    return entries;
}
