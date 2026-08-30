import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineService } from "../service.js";
import { servicePaths } from "../paths.js";
import { runReleaseTests } from "../test.js";
import { reloadPm2, startPm2, stopPm2 } from "../pm2.js";

const temps = [];
afterEach(async () => {
    await Promise.all(temps.splice(0).map((d) => rm(d, { recursive: true, force: true })));
    vi.restoreAllMocks();
});

describe("deploy pm2 + release tests", () => {
    it("runReleaseTests runs a real command", async () => {
        const root = await mkdtemp(join(tmpdir(), "cli-tk-rel-"));
        temps.push(root);
        const svc = defineService({
            name: "demo",
            appsRoot: root,
            repoUrl: "git@x/demo.git",
            pm2: { script: "i.js" },
            testCommand: "true",
        });
        const paths = servicePaths(svc);
        await mkdir(paths.shared, { recursive: true });
        await writeFile(paths.sharedEnv, "A=1\n");
        const rel = join(root, "rel");
        await mkdir(rel, { recursive: true });
        await runReleaseTests(svc, rel, paths, { logger: { info: vi.fn() } });
    });

    it("pm2 helpers honor dryRun", async () => {
        const logger = { info: vi.fn(), warn: vi.fn() };
        const paths = { ecosystem: "/apps/demo/shared/ecosystem.config.cjs" };
        await reloadPm2(paths, { dryRun: true, logger, appName: "demo" });
        await startPm2(paths, { dryRun: true, logger, appName: "demo" });
        await stopPm2("demo", { dryRun: true, logger });
        expect(logger.info).toHaveBeenCalled();
    });
});
