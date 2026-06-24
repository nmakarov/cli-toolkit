import { execSync } from "node:child_process";
import { access, chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import { runShell } from "./run.js";

async function pathExists(path) {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

function expandHome(path) {
    return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

async function ensurePm2Startup(options = {}) {
    const { user = "ubuntu", dryRun = false, logger = console } = options;

    if (dryRun) {
        logger.info("[dryRun] would configure pm2 startup systemd");
        return;
    }

    try {
        execSync("pm2 ping", { stdio: "ignore" });
    } catch {
        // pm2 daemon may not be up yet
    }

    try {
        const out = execSync(`pm2 startup systemd -u ${user} --hp /home/${user}`, { encoding: "utf8" });
        const sudoLine = out.split("\n").find((l) => l.trim().startsWith("sudo"));
        if (sudoLine) {
            execSync(sudoLine.trim(), { stdio: "inherit" });
            logger.info("pm2 startup systemd configured");
        }
    } catch (err) {
        logger.warn(`pm2 startup skipped or already configured: ${err.message}`);
    }
}

async function installDeployKey(deployKeyPath, options = {}) {
    const { dryRun = false, logger = console } = options;
    const keyPath = expandHome(deployKeyPath);

    if (!(await pathExists(keyPath))) {
        logger.warn(`deploy key not found at ${keyPath} — skipping git ssh setup`);
        return;
    }

    const keyBase = basename(keyPath);
    const sshDir = join(homedir(), ".ssh");
    const destKey = join(sshDir, keyBase);
    const configPath = join(sshDir, "config");
    const block = `
Host github.com
  HostName github.com
  User git
  IdentityFile ${destKey}
  IdentitiesOnly yes
`;

    if (dryRun) {
        logger.info(`[dryRun] would install deploy key ${keyPath} → ${destKey}`);
        return;
    }

    await mkdir(sshDir, { recursive: true, mode: 0o700 });
    await copyFile(keyPath, destKey);
    await chmod(destKey, 0o600);

    let config = "";
    if (await pathExists(configPath)) config = await readFile(configPath, "utf8");
    if (!config.includes("Host github.com")) {
        await writeFile(configPath, `${config.trimEnd()}\n${block}\n`, { mode: 0o600 });
        logger.info("updated ~/.ssh/config for github.com");
    }
    logger.info(`deploy key installed at ${destKey}`);
}

async function installLogrotate(service, options = {}) {
    const { dryRun = false, logger = console } = options;
    const conf = `/etc/logrotate.d/${service.name}`;
    const body = `${service.appsRoot}/logs/*.log {
  daily
  rotate 14
  compress
  delaycompress
  missingok
  notifempty
  copytruncate
}
`;

    if (dryRun) {
        logger.info(`[dryRun] would write ${conf}`);
        return;
    }

    const tmp = join("/tmp", `${service.name}-logrotate.conf`);
    await writeFile(tmp, body);
    await runShell(`sudo cp '${tmp}' '${conf}'`, { logger });
    logger.info(`logrotate config written: ${conf}`);
}

/** One-time host prep: pm2 systemd, optional git deploy key, logrotate. */
export async function bootstrapHost(service, options = {}) {
    const { deployKey = service.deployKey, user = "ubuntu", dryRun = false, logger = console } = options;

    await ensurePm2Startup({ user, dryRun, logger });
    if (deployKey) await installDeployKey(deployKey, { dryRun, logger });
    await installLogrotate(service, { dryRun, logger });
    logger.info("bootstrap-host complete");
}
