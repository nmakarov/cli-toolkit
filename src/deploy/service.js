/**
 * A "service" is a plain manifest object describing how to deploy one app onto a
 * host. Projects define these; the engine is otherwise project-agnostic.
 *
 * Required:
 *   name        unique id, also the default pm2 app + nginx site name
 *   appsRoot    base dir on the host, e.g. /apps/<name>
 *   repoUrl     git url to clone (ssh git@… or https://…)
 *   pm2.script  entry script (relative to the release/cwd)
 *
 * Optional (sensible defaults applied by defineService):
 *   repoDirName     default: repo name derived from repoUrl
 *   repoSubdir      default: "" (release = repo root). Set "v2" for a monorepo subdir.
 *   keepReleases    default: 3
 *   testCommand     default: null  (shell run in the release before activating; null = skip)
 *   envScrubPatterns default: []   (regex source strings; matching .env lines are dropped)
 *   legacyRepoEnv   default: null  (fallback .env path on a pre-migration host)
 *   buildInfoPath   default: "build-info.json"  (written into each release, relative to release root)
 *   deployKey       default: null  (path to a git deploy key; only needed for ssh repoUrl)
 *   requireEnv      default: false (true = fail if no .env found; false = continue with empty)
 *   pm2: {
 *     appName=name, script, args="", port,
 *     stopAllowance=60,   // seconds → injected as --stopAllowance=N on the process
 *     killTimeout=65000,  // ms; pm2 kill_timeout (default: stopAllowance*1000+5000)
 *     killRetryTime=10000, // ms; pm2 kill_retry_time (default 10s; pm2's own default is 100ms)
 *   }
 *   nginx: { siteName=name, fqdn }   (omit nginx entirely to skip the nginx step)
 */
export function deriveRepoDirName(repoUrl) {
    const tail = String(repoUrl ?? "").split("/").pop() ?? "repo";
    return tail.replace(/\.git$/, "") || "repo";
}

export function defineService(service) {
    if (!service?.name) throw new Error("service manifest needs a `name`");
    if (!service.appsRoot) throw new Error(`service "${service.name}" needs an appsRoot`);
    if (!service.repoUrl) throw new Error(`service "${service.name}" needs a repoUrl`);
    if (!service.pm2?.script) throw new Error(`service "${service.name}" needs pm2.script`);

    const pm2 = {
        appName: service.name,
        args: "",
        stopAllowance: 60,
        ...service.pm2,
    };
    if (pm2.killTimeout == null) {
        const stopSec = Number(pm2.stopAllowance);
        pm2.killTimeout = Number.isFinite(stopSec) && stopSec > 0
            ? Math.floor(stopSec * 1000) + 5000
            : 65_000;
    }
    const nginx = service.nginx
        ? { siteName: service.name, ...service.nginx }
        : null;

    return {
        repoDirName: deriveRepoDirName(service.repoUrl),
        repoSubdir: "",
        keepReleases: 3,
        testCommand: null,
        envScrubPatterns: [],
        legacyRepoEnv: null,
        buildInfoPath: "build-info.json",
        deployKey: null,
        requireEnv: false,
        ...service,
        pm2,
        nginx,
    };
}
