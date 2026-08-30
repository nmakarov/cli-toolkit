import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../run.js", () => ({
    run: vi.fn(async () => {}),
    runShell: vi.fn(async () => {}),
    runCapture: vi.fn(async () => ({
        stdout: JSON.stringify([{ name: "demo", pid: 4242, pm2_env: { status: "online" } }]),
        stderr: "",
        code: 0,
    })),
    npmEnv: (e) => ({ ...e }),
    npmInstallEnv: (e) => ({ ...e }),
}));

import { getPm2Process, waitPm2, reloadPm2, startPm2, stopPm2 } from "../pm2.js";
import { runCapture, runShell } from "../run.js";

describe("pm2 with mocked shell", () => {
    let mode;

    beforeEach(() => {
        mode = "online";
        vi.mocked(runCapture).mockImplementation(async () => {
            if (mode === "missing") return { stdout: "[]", stderr: "", code: 0 };
            if (mode === "stopped") {
                return {
                    stdout: JSON.stringify([{ name: "demo", pid: 1, pm2_env: { status: "stopped" } }]),
                    stderr: "",
                    code: 0,
                };
            }
            if (mode === "fresh") {
                return {
                    stdout: JSON.stringify([{ name: "demo", pid: 99999, pm2_env: { status: "online" } }]),
                    stderr: "",
                    code: 0,
                };
            }
            return {
                stdout: JSON.stringify([{ name: "demo", pid: 4242, pm2_env: { status: "online" } }]),
                stderr: "",
                code: 0,
            };
        });
        vi.mocked(runShell).mockImplementation(async (cmd) => {
            const s = String(cmd);
            if (s.includes("delete")) mode = "missing";
            else if (s.includes("start")) mode = "fresh";
            else if (s.includes("stop")) mode = "stopped";
        });
    });

    it("getPm2Process parses jlist", async () => {
        const proc = await getPm2Process("demo", { logger: { info: vi.fn() } });
        expect(proc.name).toBe("demo");
        expect(await getPm2Process("missing", { logger: { info: vi.fn() } })).toBe(null);
    });

    it("waitPm2 returns when predicate matches", async () => {
        const proc = await waitPm2("demo", (p) => p?.name === "demo", {
            timeoutMs: 200,
            pollMs: 10,
            logger: { info: vi.fn() },
        });
        expect(proc.pid).toBe(4242);
        const dry = await waitPm2("demo", () => false, { dryRun: true, logger: { info: vi.fn() } });
        expect(dry).toBe(null);
    });

    it("reload/start/stop with mocked pm2", async () => {
        const logger = { info: vi.fn(), warn: vi.fn() };
        const paths = { ecosystem: "/apps/demo/shared/ecosystem.config.cjs" };
        await reloadPm2(paths, { logger, appName: "demo", waitTimeoutMs: 200 });
        await startPm2(paths, { logger, appName: "demo", waitTimeoutMs: 200 });
        vi.mocked(runCapture).mockResolvedValue({
            stdout: JSON.stringify([{ name: "demo", pid: 1, pm2_env: { status: "stopped" } }]),
            stderr: "",
            code: 0,
        });
        await stopPm2("demo", { logger, waitTimeoutMs: 200 });
        vi.mocked(runCapture).mockResolvedValue({ stdout: "[]", stderr: "", code: 0 });
        await stopPm2("demo", { logger, waitTimeoutMs: 200 });
        expect(runShell).toHaveBeenCalled();
    });

    it("waitPm2 times out and getPm2Process rejects bad JSON", async () => {
        vi.mocked(runCapture).mockResolvedValue({ stdout: "not-json", stderr: "", code: 0 });
        await expect(getPm2Process("demo", { logger: { info: vi.fn() } })).rejects.toThrow(/invalid JSON/);
        mode = "online";
        vi.mocked(runCapture).mockResolvedValue({
            stdout: JSON.stringify([{ name: "other", pid: 1, pm2_env: { status: "online" } }]),
            stderr: "",
            code: 0,
        });
        await expect(
            waitPm2("demo", () => false, { timeoutMs: 30, pollMs: 10, logger: { info: vi.fn() } }),
        ).rejects.toThrow(/timed out/);
    });
});
