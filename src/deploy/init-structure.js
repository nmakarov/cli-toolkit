import { access, appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { servicePaths } from "./paths.js";

async function pathExists(path) {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

/** Fail fast with a useful message when not on a provisioned host. */
async function requireDeployRoot(parentDir, serviceRoot) {
    if (await pathExists(parentDir)) return;
    throw new Error(
        `Cannot create ${serviceRoot}: parent directory ${parentDir} does not exist.\n` +
            `This is meant to run on the target host (where ${parentDir} exists). ` +
            `For a local dry run use --appsRoot=/tmp/<service>.`,
    );
}

function buildEcosystemConfig(service, paths) {
    const { pm2 } = service;
    const outLog = join(paths.logs, `${pm2.appName}.out.log`);
    const errLog = join(paths.logs, `${pm2.appName}.err.log`);

    return `/**
 * pm2 ecosystem for ${service.name} — seeded by cli-toolkit deploy (init).
 *
 * cwd points at the \`current\` symlink (created on first deploy).
 * Tweak \`args\` here, then: pm2 reload ${paths.ecosystem} --update-env
 */
module.exports = {
    apps: [
        {
            name: "${pm2.appName}",
            script: "${pm2.script}",
            cwd: "${paths.current}",
            args: "${pm2.args}",
            instances: 1,
            exec_mode: "fork",
            autorestart: true,
            min_uptime: "10s",
            max_restarts: 10,
            restart_delay: 2000,
            max_memory_restart: "1500M",
            out_file: "${outLog}",
            error_file: "${errLog}",
            merge_logs: true,
            time: true,
            env: {
                NODE_ENV: "production",
            },
        },
    ],
};
`;
}

/** Create <appsRoot>/{releases,shared,logs} and seed shared/ecosystem.config.cjs. */
export async function initServiceStructure(service, options = {}) {
    const { dryRun = false, logger = console } = options;
    const paths = servicePaths(service);
    const dirs = [paths.releases, paths.shared, paths.logs];
    const created = [];
    const skipped = [];

    if (!dryRun) {
        await requireDeployRoot(dirname(paths.root), paths.root);
    }

    for (const dir of dirs) {
        if (await pathExists(dir)) {
            skipped.push(dir);
            continue;
        }
        if (!dryRun) await mkdir(dir, { recursive: true });
        created.push(dir);
    }

    let ecosystemCreated = false;
    if (await pathExists(paths.ecosystem)) {
        skipped.push(paths.ecosystem);
    } else {
        if (!dryRun) {
            await writeFile(paths.ecosystem, buildEcosystemConfig(service, paths), { mode: 0o644 });
        }
        ecosystemCreated = true;
        created.push(paths.ecosystem);
    }

    const line = `[${new Date().toISOString()}] init-structure service=${service.name} dryRun=${dryRun} created=${created.length} skipped=${skipped.length}\n`;
    if (!dryRun) {
        await mkdir(paths.logs, { recursive: true });
        await appendFile(paths.deployLog, line);
    }

    logger.info(`service=${service.name} appsRoot=${paths.root}`);
    logger.info(`created: ${created.length ? created.join(", ") : "(none)"}`);
    logger.info(`already present: ${skipped.length ? skipped.join(", ") : "(none)"}`);
    if (ecosystemCreated) logger.info(`seeded ${paths.ecosystem}`);

    return { paths, created, skipped, ecosystemCreated };
}
