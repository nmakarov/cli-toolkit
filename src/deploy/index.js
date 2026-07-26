/**
 * Deploy ecosystem — manifest-driven EC2 release deploys (git checkout → versioned
 * releases under /apps/<svc>/ → pm2 + nginx upstream switch, with rollback).
 *
 * Projects describe each app as a "service" manifest (see ./service.js) and drive
 * everything from one CLI (scripts/deploy/cli.js, exposed as the `cli-deploy` bin).
 * The engine itself is project-agnostic: all specifics come from the manifest.
 */
export { defineService, deriveRepoDirName } from "./service.js";
export { servicePaths, releaseStamp, releaseDir } from "./paths.js";
export { run, runShell, runCapture, npmEnv, npmInstallEnv } from "./run.js";
export { appendDeployLog } from "./log.js";
export { cloneRepo, pullRepo } from "./git.js";
export { createRelease, readCurrentRelease, listReleases } from "./release.js";
export { activateRelease } from "./activate.js";
export { installDeps } from "./deps.js";
export { runReleaseTests } from "./test.js";
export { pruneReleases } from "./prune.js";
export {
    reloadPm2,
    stopPm2,
    startPm2,
    getPm2Process,
    waitPm2,
    isPidAlive,
    isFreshOnline,
} from "./pm2.js";
export { enableNginxUpstream } from "./nginx.js";
export { syncEnv, scrubEnvContent } from "./sync-env.js";
export {
    bumpPatchVersion,
    resolveNextVersion,
    readReleaseBuildInfo,
    writeReleaseBuildInfo,
} from "./build-info.js";
export { initServiceStructure } from "./init-structure.js";
export { bootstrapHost, installOperatorShell } from "./bootstrap-host.js";
export { deployService } from "./deploy-service.js";
export { provisionService } from "./provision-service.js";
export { rollbackService } from "./rollback-service.js";
export {
    REMOTE_CLI_REL,
    parseGitHost,
    sshRun,
    shellQuote,
    ensureDeployKeyOnRemote,
    prepareGitHost,
    ensureRepoDependencies,
    ensureEnvOnRemote,
    ensureRemoteRepo,
    runRemoteCli,
    runRemoteStatus,
} from "./ssh-remote.js";
export { loadServices, resolveServiceFrom } from "./manifests.js";
