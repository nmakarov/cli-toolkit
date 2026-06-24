/**
 * Example deploy manifests for the cli-toolkit deploy ecosystem.
 *
 * A "service" describes how to deploy one app onto a host. The engine
 * (@nmakarov/cli-toolkit/deploy) is project-agnostic; everything specific to your
 * app lives here. Drive it with the `cli-deploy` CLI:
 *
 *   # remote (SSH Host alias), from your laptop:
 *   cli-deploy setup    --service=web --host=web-prod --manifests=examples/deploy/services.js
 *   cli-deploy deploy   --service=web --host=web-prod --manifests=examples/deploy/services.js
 *   cli-deploy rollback --service=web --host=web-prod --manifests=examples/deploy/services.js
 *   cli-deploy status   --service=web --host=web-prod --manifests=examples/deploy/services.js
 *
 *   # local dry run (no host needed), rehearses the whole pipeline under /tmp:
 *   cli-deploy deploy --service=web --manifests=examples/deploy/services.js \
 *     --appsRoot=/tmp/web --dryRun
 *
 * The module must export `services` (a map or array). Each entry is normalized by
 * defineService(); only name/appsRoot/repoUrl/pm2.script are required.
 */
export const services = {
    web: {
        name: "web", // also the default pm2 app + nginx site name
        appsRoot: "/apps/web", // base dir on the host
        repoUrl: "git@github.com:acme/web.git", // ssh or https
        // repoSubdir: "v2",          // set if the app lives in a monorepo subdir
        // deployKey: "~/.ssh/web_deploy",  // git deploy key (ssh repos only)
        keepReleases: 3,
        testCommand: "npm run test:ci", // shell run in the release; null/omit to skip
        pm2: {
            // appName defaults to name
            script: "./src/index.js",
            args: "--port=3000",
            port: 3000, // what nginx proxies to (also used by `status`)
        },
        nginx: {
            // siteName defaults to name
            fqdn: "web.example.com",
        },
    },

    // A second app on a different host (pick the host at runtime with --host):
    worker: {
        name: "worker",
        appsRoot: "/apps/worker",
        repoUrl: "git@github.com:acme/worker.git",
        pm2: { script: "./src/worker.js" }, // no nginx → the nginx step is skipped
    },
};
