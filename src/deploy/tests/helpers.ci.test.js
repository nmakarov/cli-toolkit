import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineService, deriveRepoDirName } from "../service.js";
import { servicePaths, releaseStamp, releaseDir } from "../paths.js";
import { bumpPatchVersion, resolveNextVersion, readReleaseBuildInfo, writeReleaseBuildInfo } from "../build-info.js";
import { scrubEnvContent, syncEnv } from "../sync-env.js";
import { loadServices, resolveServiceFrom } from "../manifests.js";
import { parsePm2Jlist, isPidAlive, isFreshOnline } from "../pm2.js";
import { npmEnv, npmInstallEnv, run, runCapture, runShell } from "../run.js";
import { createRelease, readCurrentRelease, listReleases } from "../release.js";
import { pruneReleases } from "../prune.js";
import { deployNotice, appendDeployLog } from "../log.js";
import { activateRelease } from "../activate.js";
import { cloneRepo, pullRepo } from "../git.js";
import { runReleaseTests } from "../test.js";
import { initServiceStructure } from "../init-structure.js";

const temps = [];

async function tmp(prefix = "cli-tk-") {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    temps.push(dir);
    return dir;
}

afterEach(async () => {
    await Promise.all(temps.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

function baseService(appsRoot, extra = {}) {
    return defineService({
        name: "demo",
        appsRoot,
        repoUrl: "git@github.com:acme/demo.git",
        pm2: { script: "index.js" },
        ...extra,
    });
}

describe("deploy helpers", () => {
    it("defineService fills defaults and deriveRepoDirName strips .git", () => {
        expect(deriveRepoDirName("git@host:org/my-app.git")).toBe("my-app");
        expect(deriveRepoDirName("")).toBe("repo");
        expect(() => defineService({})).toThrow(/name/);
        expect(() => defineService({ name: "x" })).toThrow(/appsRoot/);
        expect(() => defineService({ name: "x", appsRoot: "/a" })).toThrow(/repoUrl/);
        expect(() => defineService({ name: "x", appsRoot: "/a", repoUrl: "u" })).toThrow(/pm2.script/);

        const svc = baseService("/apps/demo", { nginx: { fqdn: "demo.example" }, pm2: { script: "app.js", stopAllowance: 30 } });
        expect(svc.repoDirName).toBe("demo");
        expect(svc.keepReleases).toBe(3);
        expect(svc.pm2.killTimeout).toBe(35_000);
        expect(svc.nginx.siteName).toBe("demo");
        expect(svc.nginx.fqdn).toBe("demo.example");
    });

    it("servicePaths and releaseStamp", () => {
        const svc = baseService("/apps/demo", { repoSubdir: "v2" });
        const paths = servicePaths(svc);
        expect(paths.repoRun).toBe(join("/apps/demo", "demo", "v2"));
        expect(paths.current).toBe(join("/apps/demo", "current"));
        expect(releaseStamp(new Date("2026-01-02T03:04:05.678Z"))).toBe("2026-01-02T03:04:05Z");
        expect(releaseDir("/apps/demo/releases", "stamp")).toBe(join("/apps/demo/releases", "stamp"));
    });

    it("bumpPatchVersion and build-info read/write", async () => {
        expect(bumpPatchVersion("1.2.3")).toBe("1.2.4");
        expect(bumpPatchVersion("bad")).toBe("0.0.1");

        const root = await tmp();
        const svc = baseService(root);
        const paths = servicePaths(svc);
        await mkdir(paths.repoRun, { recursive: true });
        await writeFile(join(paths.repoRun, "package.json"), JSON.stringify({ version: "0.2.0" }));
        const version = await resolveNextVersion(svc, paths, join(paths.repoRun, "package.json"));
        expect(version).toBe("0.2.0");

        const releasePath = join(root, "releases", "r1");
        const dry = await writeReleaseBuildInfo(svc, releasePath, {
            stamp: "r1",
            dryRun: true,
            logger: { info: vi.fn() },
        });
        expect(dry.version).toBe("0.2.0");
        expect(dry.service).toBe("demo");

        const written = await writeReleaseBuildInfo(svc, releasePath, {
            stamp: "r1",
            logger: { info: vi.fn() },
        });
        expect(await readReleaseBuildInfo(svc, releasePath)).toMatchObject({ version: written.version, release: "r1" });
    });

    it("scrubEnvContent and syncEnv", async () => {
        const raw = "KEEP=1\nDROP_ME=2\n";
        expect(scrubEnvContent(raw, [])).toBe(raw);
        expect(scrubEnvContent(raw, [/^DROP_/])).toBe("KEEP=1\n");

        const root = await tmp();
        const svc = baseService(root, { envScrubPatterns: ["^SECRET="], requireEnv: false });
        const paths = servicePaths(svc);
        const logger = { info: vi.fn(), warn: vi.fn() };
        expect(await syncEnv(svc, { dryRun: true, logger })).toMatchObject({ dest: paths.sharedEnv });

        const empty = await syncEnv(svc, { logger });
        expect(empty.source).toBe(null);
        expect(await readFile(paths.sharedEnv, "utf8")).toBe("");

        await mkdir(paths.repoRun, { recursive: true });
        await writeFile(paths.repoEnv, "KEEP=1\nSECRET=nope\n");
        const synced = await syncEnv(svc, { logger });
        expect(synced.source).toBe(paths.repoEnv);
        expect(await readFile(paths.sharedEnv, "utf8")).toBe("KEEP=1\n");

        const strict = baseService(join(root, "strict"), { requireEnv: true });
        await expect(syncEnv(strict, { logger })).rejects.toThrow(/No \.env found/);
    });

    it("loadServices and resolveServiceFrom", async () => {
        const dir = await tmp();
        const file = join(dir, "services.mjs");
        await writeFile(
            file,
            `export const services = {
                demo: { name: "demo", appsRoot: "/apps/demo", repoUrl: "git@x/demo.git", pm2: { script: "i.js" } }
            };\n`,
        );
        const map = await loadServices({ manifests: file });
        expect(map.demo.pm2.script).toBe("i.js");
        expect(resolveServiceFrom(map, "demo", { appsRoot: "/other" }).appsRoot).toBe("/other");
        expect(() => resolveServiceFrom(map, "nope")).toThrow(/Unknown service/);
        await expect(loadServices({ manifests: join(dir, "missing.mjs") })).rejects.toThrow(/Could not load/);

        const empty = join(dir, "empty.mjs");
        await writeFile(empty, "export const other = 1;\n");
        await expect(loadServices({ manifests: empty })).rejects.toThrow(/must export/);
    });

    it("parsePm2Jlist, isPidAlive, isFreshOnline", () => {
        expect(parsePm2Jlist("")).toEqual([]);
        expect(parsePm2Jlist("[PM2] Spawning PM2 daemon...\n[]")).toEqual([]);
        expect(parsePm2Jlist('[PM2] hi\n[{"name":"app"}]')).toEqual([{ name: "app" }]);
        expect(() => parsePm2Jlist("not-json")).toThrow(/invalid JSON/);
        expect(parsePm2Jlist("{}")).toEqual([]);
        expect(isPidAlive(-1)).toBe(false);
        expect(isPidAlive(process.pid)).toBe(true);
        expect(isFreshOnline({ pm2_env: { status: "stopped" }, pid: 9 }, 1)).toBe(false);
        expect(isFreshOnline({ pm2_env: { status: "online" }, pid: process.pid }, process.pid)).toBe(false);
        expect(isFreshOnline({ pm2_env: { status: "online" }, pid: 999999991 }, 1)).toBe(true);
    });

    it("npmEnv / run / runCapture", async () => {
        expect(npmEnv({ NODE_ENV: "production", X: "1" }).NODE_ENV).toBeUndefined();
        expect(npmInstallEnv({ NODE_ENV: "production" }).NPM_CONFIG_PRODUCTION).toBe("false");
        await run("node", ["-e", "process.exit(0)"], { logger: { info: vi.fn() } });
        await expect(run("node", ["-e", "process.exit(2)"], { logger: { info: vi.fn() } })).rejects.toThrow(/exited with code 2/);
        const cap = await runCapture("node", ["-e", "process.stdout.write('hi')"], { logger: { info: vi.fn() } });
        expect(cap.stdout).toBe("hi");
        const fail = await runCapture("node", ["-e", "process.exit(3)"], { allowFail: true, logger: { info: vi.fn() } });
        expect(fail.code).toBe(3);
        await runShell("true", { logger: { info: vi.fn() } });
    });

    it("createRelease, list, activate, prune", async () => {
        const root = await tmp();
        const svc = baseService(root, { keepReleases: 2 });
        const paths = servicePaths(svc);
        await mkdir(paths.repoRun, { recursive: true });
        await writeFile(join(paths.repoRun, "app.js"), "ok");
        await mkdir(join(paths.repoRun, "node_modules"), { recursive: true });
        await writeFile(join(paths.repoRun, "node_modules", "x"), "skip");

        const dry = await createRelease(svc, { stamp: "2026-01-01T00:00:00Z", dryRun: true, logger: { info: vi.fn() } });
        expect(dry.stamp).toBe("2026-01-01T00:00:00Z");

        const r1 = await createRelease(svc, { stamp: "2026-01-01T00:00:00Z", logger: { info: vi.fn() } });
        const r2 = await createRelease(svc, { stamp: "2026-01-02T00:00:00Z", logger: { info: vi.fn() } });
        const r3 = await createRelease(svc, { stamp: "2026-01-03T00:00:00Z", logger: { info: vi.fn() } });
        expect(await readFile(join(r1.path, "app.js"), "utf8")).toBe("ok");

        await mkdir(paths.shared, { recursive: true });
        await writeFile(paths.sharedEnv, "ENV=1\n");
        await activateRelease(r2.path, paths, { logger: { info: vi.fn() } });
        expect(await readCurrentRelease(paths)).toContain(r2.stamp);

        const listed = await listReleases(paths);
        expect(listed.map((x) => x.name)).toEqual([r3.stamp, r2.stamp, r1.stamp]);

        const pruned = await pruneReleases(svc, paths, { logger: { info: vi.fn() }, protect: [r1.stamp] });
        expect(pruned.removed).toEqual([]);
        const pruned2 = await pruneReleases(svc, paths, { dryRun: true, logger: { info: vi.fn() } });
        expect(Array.isArray(pruned2.removed)).toBe(true);
    });

    it("deployNotice and appendDeployLog", async () => {
        const notice = vi.fn();
        const info = vi.fn();
        deployNotice({ notice }, "hello");
        deployNotice({ info }, "hello");
        expect(notice).toHaveBeenCalledWith("hello");
        expect(info).toHaveBeenCalledWith("hello");
        const dir = await tmp();
        const logPath = join(dir, "logs", "deploy.log");
        await appendDeployLog(logPath, "line");
        expect(await readFile(logPath, "utf8")).toMatch(/line/);
    });

    it("git dry-run and missing-repo errors", async () => {
        const root = await tmp();
        const svc = baseService(root);
        const logger = { info: vi.fn() };
        await cloneRepo(svc, { dryRun: true, logger });
        await expect(pullRepo(svc, { logger })).rejects.toThrow(/Repo missing/);
        await mkdir(servicePaths(svc).repo, { recursive: true });
        await expect(cloneRepo(svc, { logger })).rejects.toThrow(/already exists/);
        await pullRepo(svc, { dryRun: true, logger });
    });

    it("runReleaseTests skip / dryRun and initServiceStructure", async () => {
        const root = await tmp();
        const logger = { info: vi.fn() };
        const svc = baseService(root);
        const paths = servicePaths(svc);
        await runReleaseTests(svc, join(root, "rel"), paths, { logger });
        const withTests = baseService(root, { testCommand: "true" });
        await runReleaseTests(withTests, join(root, "rel"), paths, { dryRun: true, logger });

        const local = baseService(join(root, "app"));
        await initServiceStructure(local, { logger });
        expect(await readFile(servicePaths(local).ecosystem, "utf8")).toMatch(/demo/);
    });
});
