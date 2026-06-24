import { access, readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { spawn } from "node:child_process";

import { scrubEnvContent } from "./sync-env.js";
import { servicePaths } from "./paths.js";

/** Path (relative to the run dir on the server) of the toolkit deploy CLI. */
export const REMOTE_CLI_REL = "node_modules/@nmakarov/cli-toolkit/scripts/deploy/cli.js";

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

function resolveLocalEnvPath(envFile) {
    if (envFile) {
        const expanded = expandHome(envFile);
        return expanded.startsWith("/") ? expanded : join(process.cwd(), expanded);
    }
    return join(process.cwd(), ".env");
}

/** Parse the ssh host out of a git url (git@host:..., ssh://git@host/...). null for https. */
export function parseGitHost(repoUrl) {
    const u = String(repoUrl ?? "");
    let m = u.match(/^[^@]+@([^:]+):/); // git@github.com:org/repo.git
    if (m) return m[1];
    m = u.match(/^ssh:\/\/[^@]+@([^/:]+)/); // ssh://git@github.com/org/repo.git
    if (m) return m[1];
    return null;
}

export function shellQuote(value) {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export function sshRun(host, remoteCommand, options = {}) {
    const { logger } = options;
    return new Promise((resolve, reject) => {
        logger?.info?.(`ssh ${host} ${remoteCommand.slice(0, 120)}${remoteCommand.length > 120 ? "…" : ""}`);
        const child = spawn("ssh", [host, remoteCommand], { stdio: "inherit" });
        child.on("error", reject);
        child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ssh ${host} exited with code ${code}`))));
    });
}

function scp(localPath, remoteSpec) {
    return new Promise((resolve, reject) => {
        const child = spawn("scp", [localPath, remoteSpec], { stdio: "inherit" });
        child.on("error", reject);
        child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`scp exited with code ${code}`))));
    });
}

/** Copy a git deploy key from the laptop to the server (no-op if not present locally). */
export async function ensureDeployKeyOnRemote(host, deployKeyPath, options = {}) {
    const { logger = console } = options;
    if (!deployKeyPath) return false;
    const localPath = expandHome(deployKeyPath);
    if (!(await pathExists(localPath))) return false;

    const keyBase = basename(localPath);
    logger.info(`copying deploy key ${localPath} → ${host}:~/.ssh/${keyBase}`);
    await sshRun(host, "mkdir -p ~/.ssh && chmod 700 ~/.ssh", { logger });
    await scp(localPath, `${host}:.ssh/${keyBase}`, { logger });
    await sshRun(host, `chmod 600 ~/.ssh/${keyBase}`, { logger });
    return true;
}

/** known_hosts for the git host + (optional) ~/.ssh/config IdentityFile for the deploy key. */
export async function prepareGitHost(host, options = {}) {
    const { logger = console, gitHost, keyBasename } = options;
    if (!gitHost) return;

    const configBlock = keyBasename
        ? `if ! grep -q 'Host ${gitHost}' ~/.ssh/config 2>/dev/null; then
  printf '%s\\n' '' 'Host ${gitHost}' '  HostName ${gitHost}' '  User git' '  IdentityFile ~/.ssh/${keyBasename}' '  IdentitiesOnly yes' >> ~/.ssh/config
  chmod 600 ~/.ssh/config
  echo "configured ~/.ssh/config for ${gitHost}"
fi`
        : `:`;

    const script = `
set -euo pipefail
mkdir -p ~/.ssh
chmod 700 ~/.ssh
if ! grep -q '^${gitHost}' ~/.ssh/known_hosts 2>/dev/null; then
  ssh-keyscan -t ed25519,rsa ${gitHost} >> ~/.ssh/known_hosts 2>/dev/null
  echo "added ${gitHost} to known_hosts"
fi
${configBlock}
`.trim();

    await sshRun(host, script, { logger });
}

/** Install the run-dir workspace deps so the toolkit CLI is available on the server. */
export async function ensureRepoDependencies(host, service, options = {}) {
    const { logger = console } = options;
    const paths = servicePaths(service);
    const run = shellQuote(paths.repoRun);
    await sshRun(
        host,
        `cd ${run} && if [ ! -d node_modules/@nmakarov/cli-toolkit ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then npm ci; fi`,
        { logger },
    );
}

/** Copy laptop .env → server run-dir .env (scrubbed). sync-env then copies it to shared/. */
export async function ensureEnvOnRemote(host, service, options = {}) {
    const { logger = console, envFile } = options;
    const paths = servicePaths(service);
    const localPath = resolveLocalEnvPath(envFile);
    if (!(await pathExists(localPath))) return false;

    logger.info(`copying .env ${localPath} → ${host}:${paths.repoEnv}`);
    await sshRun(host, `mkdir -p ${shellQuote(dirname(paths.repoEnv))}`, { logger });

    const scrubbed = scrubEnvContent(await readFile(localPath, "utf8"), service.envScrubPatterns ?? []);
    const tmp = join(tmpdir(), `deploy-env-${Date.now()}`);
    await writeFile(tmp, scrubbed, { mode: 0o600 });
    await scp(tmp, `${host}:${paths.repoEnv}`, { logger });
    await sshRun(host, `chmod 600 ${shellQuote(paths.repoEnv)}`, { logger });
    return true;
}

/** Ensure a checkout exists on the server, then pull latest + deps + env. */
export async function ensureRemoteRepo(host, service, options = {}) {
    const { logger = console, deployKey = service.deployKey, envFile } = options;
    const paths = servicePaths(service);
    const repo = shellQuote(paths.repo);
    const repoUrl = shellQuote(service.repoUrl);
    const root = shellQuote(paths.root);

    const localKeyBase = deployKey ? basename(expandHome(deployKey)) : null;
    await ensureDeployKeyOnRemote(host, deployKey, { logger });
    await prepareGitHost(host, { logger, gitHost: parseGitHost(service.repoUrl), keyBasename: localKeyBase });

    await sshRun(
        host,
        `mkdir -p ${root} && if [ -d ${repo}/.git ]; then git -C ${repo} pull --ff-only; else git clone ${repoUrl} ${repo}; fi`,
        { logger },
    );

    await ensureRepoDependencies(host, service, { logger });
    await ensureEnvOnRemote(host, service, { logger, envFile });
}

/**
 * Invoke the toolkit deploy CLI on the server in local mode (no --host), passing
 * the same --service/--manifests + extra flags. Run after ensureRemoteRepo.
 */
export async function runRemoteCli(host, service, command, args = [], options = {}) {
    const { logger = console, manifests, skipPull = false, deployKey = service.deployKey, envFile } = options;
    const paths = servicePaths(service);
    const run = shellQuote(paths.repoRun);
    const cli = shellQuote(REMOTE_CLI_REL);

    if (!skipPull) {
        await ensureRemoteRepo(host, service, { logger, deployKey, envFile });
    } else {
        await ensureRepoDependencies(host, service, { logger });
        await ensureEnvOnRemote(host, service, { logger, envFile });
    }

    const passthrough = [
        `--service=${service.name}`,
        ...(manifests ? [`--manifests=${manifests}`] : []),
        ...args,
    ].map(shellQuote).join(" ");

    await sshRun(host, `cd ${run} && node ${cli} ${shellQuote(command)} ${passthrough}`.trim(), { logger });
}

export async function runRemoteStatus(host, service, options = {}) {
    const { logger = console } = options;
    const paths = servicePaths(service);
    const port = service.pm2.port;
    const app = service.pm2.appName;

    const script = `
echo "=== apps root ==="
ls -la ${shellQuote(paths.root)} 2>/dev/null || echo "(missing)"
echo ""
echo "=== current ==="
readlink ${shellQuote(paths.current)} 2>/dev/null || echo "(not set)"
echo ""
echo "=== releases ==="
ls -1 ${shellQuote(paths.releases)} 2>/dev/null || echo "(none)"
echo ""
echo "=== pm2 ==="
pm2 describe ${app} 2>/dev/null | head -20 || pm2 status ${app} 2>/dev/null || echo "(not running)"
${port ? `echo ""
echo "=== app health (localhost) ==="
curl -sf http://127.0.0.1:${port}/healthz 2>/dev/null || echo "(no /healthz on :${port})"` : ""}
`.trim();

    await sshRun(host, script, { logger });
}
