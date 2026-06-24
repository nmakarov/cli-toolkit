import { access, mkdir, readFile, writeFile } from "node:fs/promises";

import { servicePaths } from "./paths.js";

/**
 * Drop .env lines matching any of the service's envScrubPatterns (regex source
 * strings). Useful to strip empty keys that would crash strict param validation.
 */
export function scrubEnvContent(content, patterns = []) {
    const regexes = patterns.map((p) => (p instanceof RegExp ? p : new RegExp(p)));
    if (regexes.length === 0) return content;
    return content
        .split("\n")
        .filter((line) => !regexes.some((re) => re.test(line.trim())))
        .join("\n");
}

async function pathExists(path) {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

/** Copy <repoRun>/.env → shared/.env (with optional legacy fallback + scrubbing). */
export async function syncEnv(service, options = {}) {
    const { dryRun = false, logger = console } = options;
    const paths = servicePaths(service);
    const patterns = service.envScrubPatterns ?? [];

    if (dryRun) {
        logger.info(`[dryRun] would sync ${paths.repoEnv} → ${paths.sharedEnv}`);
        return { source: paths.repoEnv, dest: paths.sharedEnv };
    }

    let source = paths.repoEnv;
    if (!(await pathExists(source)) && service.legacyRepoEnv && (await pathExists(service.legacyRepoEnv))) {
        logger.info(`using legacy env: ${service.legacyRepoEnv}`);
        source = service.legacyRepoEnv;
    }

    await mkdir(paths.shared, { recursive: true });

    if (!(await pathExists(source))) {
        if (service.requireEnv) {
            throw new Error(
                `No .env found at ${paths.repoEnv}` +
                    (service.legacyRepoEnv ? ` or ${service.legacyRepoEnv}` : "") +
                    " — place .env on the host or run the remote deploy from a laptop with a local .env (auto-scp)",
            );
        }
        // Optional env: ensure shared/.env exists so the per-release symlink is valid.
        if (!(await pathExists(paths.sharedEnv))) {
            await writeFile(paths.sharedEnv, "", { mode: 0o600 });
        }
        logger.warn(`no .env found (source ${source}) — using empty ${paths.sharedEnv}`);
        return { source: null, dest: paths.sharedEnv };
    }

    const raw = await readFile(source, "utf8");
    await writeFile(paths.sharedEnv, scrubEnvContent(raw, patterns), { mode: 0o600 });
    logger.info(`synced ${source} → ${paths.sharedEnv}`);
    return { source, dest: paths.sharedEnv };
}
