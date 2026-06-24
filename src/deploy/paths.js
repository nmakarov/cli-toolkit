import { join } from "node:path";

/**
 * Resolve on-disk paths for a service under <appsRoot>/.
 *
 *   <appsRoot>/
 *     <repoDirName>/[<repoSubdir>/]   git checkout (build source only)
 *     releases/<stamp>/               one release = contents of the run dir
 *     shared/.env, ecosystem.config.cjs
 *     logs/deploy.log
 *     current -> releases/<stamp>
 */
export function servicePaths(service) {
    const root = service.appsRoot;
    const repoDirName = service.repoDirName ?? "repo";
    const repoSubdir = service.repoSubdir ?? "";

    const repo = join(root, repoDirName);
    const repoRun = repoSubdir ? join(repo, repoSubdir) : repo;

    return {
        root,
        repo,
        repoRun,
        repoEnv: join(repoRun, ".env"),
        releases: join(root, "releases"),
        shared: join(root, "shared"),
        logs: join(root, "logs"),
        current: join(root, "current"),
        sharedEnv: join(root, "shared", ".env"),
        ecosystem: join(root, "shared", "ecosystem.config.cjs"),
        deployLog: join(root, "logs", "deploy.log"),
        lockHashFile: join(root, "shared", ".package-lock.sha256"),
    };
}

/** ISO-8601 release stamp with `:` (safe on Linux ext4). */
export function releaseStamp(date = new Date()) {
    return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function releaseDir(releasesRoot, stamp) {
    return join(releasesRoot, stamp);
}
