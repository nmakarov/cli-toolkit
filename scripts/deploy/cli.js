#!/usr/bin/env node
/**
 * cli-deploy — manifest-driven release deploys to EC2 (local or over SSH).
 *
 * Projects describe each app in a manifests module (default ./deploy/services.js)
 * that exports `services` (a map/array of service manifests). Then:
 *
 *   # from your laptop, over SSH (uses ~/.ssh/config Host alias):
 *   cli-deploy setup    --service=web --host=web-prod
 *   cli-deploy deploy   --service=web --host=web-prod
 *   cli-deploy rollback --service=web --host=web-prod
 *   cli-deploy status   --service=web --host=web-prod
 *
 *   # directly on the host (no --host):
 *   cli-deploy deploy   --service=web
 *
 * Commands: setup | bootstrap | init | provision | deploy | rollback | status
 *
 * Common flags (cli-toolkit params; CLI/env/.env):
 *   --service     (required) service name from the manifests module
 *   --manifests   path to manifests module (default deploy/services.js)
 *   --host        ssh Host alias → run remotely (omit to run locally)
 *   --appsRoot    override the manifest appsRoot (handy for /tmp dry runs)
 *   --dryRun --skipPull --skipTests --skipNginx
 *   --withBootstrap --noDeploy        (provision)
 *   --release=<stamp>                  (rollback to a specific release)
 *   --deployKey=~/.ssh/key             (git deploy key, ssh repos)
 *   --envFile=path/to/.env             (laptop .env to scp; default ./.env)
 */

import { init } from "../../dist/init.js";
import {
    loadServices,
    resolveServiceFrom,
    bootstrapHost,
    initServiceStructure,
    provisionService,
    deployService,
    rollbackService,
    ensureRemoteRepo,
    runRemoteCli,
    runRemoteStatus,
    servicePaths,
    listReleases,
    readCurrentRelease,
} from "../../dist/deploy.js";

const COMMANDS = ["setup", "bootstrap", "init", "provision", "deploy", "rollback", "status"];

function remotePassthrough(flags) {
    const out = [];
    const bools = ["dryRun", "skipPull", "skipTests", "skipNginx", "noDeploy", "withBootstrap"];
    for (const k of bools) if (flags[k]) out.push(`--${k}`);
    if (flags.release) out.push(`--release=${flags.release}`);
    if (flags.deployKey) out.push(`--deployKey=${flags.deployKey}`);
    return out;
}

async function localStatus(service, logger) {
    const paths = servicePaths(service);
    const current = await readCurrentRelease(paths);
    const releases = await listReleases(paths);
    logger.info(`service   ${service.name}`);
    logger.info(`appsRoot  ${paths.root}`);
    logger.info(`current   ${current ?? "(not set)"}`);
    logger.info(`releases  ${releases.length ? releases.map((r) => r.name).join(", ") : "(none)"}`);
}

const flow = async (context) => {
    const { logger, params } = context;
    const command = (context.args.getCommands?.() ?? [])[0];
    const serviceName = params.get("service", "string optional");
    const host = params.get("host", "string optional");
    const manifests = params.get("manifests", "string default deploy/services.js");

    const flags = params.getAll({
        dryRun: "boolean default false",
        skipPull: "boolean default false",
        skipTests: "boolean default false",
        skipNginx: "boolean default false",
        withBootstrap: "boolean default false",
        noDeploy: "boolean default false",
        appsRoot: "string optional",
        release: "string optional",
        deployKey: "string optional",
        envFile: "string optional",
    });

    if (!command || !serviceName || !COMMANDS.includes(command)) {
        logger.error("Usage: cli-deploy <command> --service=<name> [--host=<ssh>] [flags]");
        logger.error(`Commands: ${COMMANDS.join(", ")}`);
        logger.error("Example: cli-deploy deploy --service=web --host=web-prod");
        process.exitCode = 2;
        return;
    }

    let serviceMap;
    try {
        serviceMap = await loadServices({ manifests });
    } catch (err) {
        logger.error(err.message);
        process.exitCode = 2;
        return;
    }

    let service;
    try {
        service = resolveServiceFrom(serviceMap, serviceName, { appsRoot: flags.appsRoot });
    } catch (err) {
        logger.error(err.message);
        process.exitCode = 2;
        return;
    }
    if (flags.deployKey) service = { ...service, deployKey: flags.deployKey };

    // ── Remote: orchestrate over SSH, re-invoking this CLI on the host ──────────
    if (host) {
        const extra = remotePassthrough(flags);
        const opts = { logger, manifests, deployKey: service.deployKey, envFile: flags.envFile };
        logger.info(`remote ${command} service=${service.name} host=${host}`);

        switch (command) {
            case "setup":
                await ensureRemoteRepo(host, service, opts);
                await runRemoteCli(host, service, "bootstrap", extra, { ...opts, skipPull: true });
                await runRemoteCli(host, service, "init", extra, { ...opts, skipPull: true });
                await runRemoteCli(host, service, "provision", extra, { ...opts, skipPull: true });
                break;
            case "status":
                await runRemoteStatus(host, service, { logger });
                break;
            default:
                await runRemoteCli(host, service, command, extra, opts);
        }
        return;
    }

    // ── Local: run the step(s) on this machine (the host, or a dry run) ─────────
    logger.info(`local ${command} service=${service.name}`);
    switch (command) {
        case "bootstrap":
            await bootstrapHost(service, { deployKey: service.deployKey, dryRun: flags.dryRun, logger });
            break;
        case "init":
            await initServiceStructure(service, { dryRun: flags.dryRun, logger });
            break;
        case "provision":
            await provisionService(service, {
                dryRun: flags.dryRun,
                deploy: !flags.noDeploy,
                skipBootstrap: !flags.withBootstrap,
                deployKey: flags.withBootstrap ? service.deployKey : undefined,
                logger,
            });
            break;
        case "deploy":
            await deployService(service, {
                dryRun: flags.dryRun,
                skipPull: flags.skipPull,
                skipTests: flags.skipTests,
                skipNginx: flags.skipNginx,
                logger,
            });
            break;
        case "rollback":
            await rollbackService(service, { release: flags.release, dryRun: flags.dryRun, logger });
            break;
        case "setup":
            await bootstrapHost(service, { deployKey: service.deployKey, dryRun: flags.dryRun, logger });
            await initServiceStructure(service, { dryRun: flags.dryRun, logger });
            await provisionService(service, { dryRun: flags.dryRun, deploy: !flags.noDeploy, skipBootstrap: true, logger });
            break;
        case "status":
            await localStatus(service, logger);
            break;
        default:
            break;
    }
};

init(flow);
