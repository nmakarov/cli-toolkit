import { rm, readlink } from "node:fs/promises";

import { listReleases } from "./release.js";

/** Remove old releases, keeping the newest N (always keeps the active one). */
export async function pruneReleases(service, paths, options = {}) {
    const { dryRun = false, logger = console } = options;
    const keep = service.keepReleases ?? 3;
    const releases = await listReleases(paths);

    let activeName = null;
    try {
        const target = await readlink(paths.current);
        activeName = target.split("/").pop();
    } catch {
        // no current
    }

    const keepSet = new Set();
    for (const rel of releases) {
        if (keepSet.size < keep) keepSet.add(rel.name);
    }
    if (activeName) keepSet.add(activeName);

    const toRemove = releases.filter((rel) => !keepSet.has(rel.name));
    for (const rel of toRemove) {
        if (dryRun) {
            logger.info(`[dryRun] would rm -rf ${rel.path}`);
        } else {
            await rm(rel.path, { recursive: true, force: true });
            logger.info(`pruned ${rel.path}`);
        }
    }

    return { removed: toRemove.map((r) => r.name) };
}
