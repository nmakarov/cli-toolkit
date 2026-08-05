import { describe, it, expect, vi, afterEach } from "vitest";
import { isFreshOnline, isPidAlive, parsePm2Jlist } from "../pm2.js";

describe("parsePm2Jlist", () => {
    it("parses a bare JSON array", () => {
        expect(parsePm2Jlist('[{"name":"app"}]')).toEqual([{ name: "app" }]);
    });

    it("strips PM2 daemon spawn banners before the JSON", () => {
        const stdout =
            "[PM2] Spawning PM2 daemon with pm2_home=/home/ubuntu/.pm2\n" +
            "[PM2] PM2 Successfully daemonized\n" +
            '[{"name":"photo-care-runner"}]';
        expect(parsePm2Jlist(stdout)).toEqual([{ name: "photo-care-runner" }]);
    });

    it("returns [] for empty stdout", () => {
        expect(parsePm2Jlist("")).toEqual([]);
        expect(parsePm2Jlist("[]")).toEqual([]);
    });
});

describe("pm2 reload wait helpers", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("isFreshOnline rejects missing/stopped procs", () => {
        expect(isFreshOnline(null, 1)).toBe(false);
        expect(isFreshOnline({ pid: 2, pm2_env: { status: "stopping" } }, 1)).toBe(false);
    });

    it("isFreshOnline rejects the old pid even when status is online", () => {
        expect(isFreshOnline({ pid: 10, pm2_env: { status: "online" } }, 10)).toBe(false);
    });

    it("isFreshOnline requires old pid to be dead", () => {
        vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
            if (signal === 0 && pid === 99) return true; // still alive
            throw new Error("ESRCH");
        });
        expect(isFreshOnline({ pid: 100, pm2_env: { status: "online" } }, 99)).toBe(false);
    });

    it("isFreshOnline accepts new online pid when old is gone", () => {
        vi.spyOn(process, "kill").mockImplementation(() => {
            throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
        });
        expect(isFreshOnline({ pid: 100, pm2_env: { status: "online" } }, 99)).toBe(true);
        expect(isPidAlive(99)).toBe(false);
    });
});
