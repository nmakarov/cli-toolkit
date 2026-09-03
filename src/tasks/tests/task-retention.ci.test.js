import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, readdirSync, utimesSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
    deleteHistoryOlderThan,
    effectiveRetentionDays,
    maybePruneTaskRetention,
    pruneTaskRetention,
    readRetentionConfig,
    retentionCutoffIso,
    seedTaskRetentionRuntime,
} from "../taskRetention.js";
import { planIpcLogPrune, pruneIpcLogsOlderThan } from "../taskLogs.js";
import { coerceRuntimeValue } from "../runtimeParams.js";
import { FileDatabase } from "../../filedatabase/index.js";

describe("retention policy", () => {
    it("keeps the configured window when disk is healthy", () => {
        expect(
            effectiveRetentionDays(
                { days: 7, minFreeRatio: 0.1, minHours: 6 },
                { free: 90, total: 100, freeRatio: 0.9 },
            ),
        ).toEqual({ days: 7, diskAdjusted: false, freeRatio: 0.9 });
    });

    it("shrinks toward minHours when free space is below the ratio", () => {
        const out = effectiveRetentionDays(
            { days: 7, minFreeRatio: 0.1, minHours: 6 },
            { free: 5, total: 100, freeRatio: 0.05 },
        );
        expect(out.diskAdjusted).toBe(true);
        expect(out.days).toBeCloseTo(3.5, 5);
        const tight = effectiveRetentionDays(
            { days: 7, minFreeRatio: 0.1, minHours: 6 },
            { free: 0.2, total: 100, freeRatio: 0.002 },
        );
        expect(tight.days).toBeCloseTo(6 / 24, 5);
    });

    it("computes an ISO cutoff from days", () => {
        const now = new Date("2026-08-24T12:00:00.000Z");
        expect(retentionCutoffIso(7, now)).toBe("2026-08-17T12:00:00.000Z");
    });

    it("treats days<=0 or enabled=false as disabled", () => {
        expect(readRetentionConfig({ tasksRetentionEnabled: false, tasksRetentionDays: 7 }).enabled).toBe(
            false,
        );
        expect(readRetentionConfig({ tasksRetentionDays: 0 }).enabled).toBe(false);
        expect(readRetentionConfig({ tasksRetentionDays: 7 }).enabled).toBe(true);
    });
});

describe("planIpcLogPrune", () => {
    const cutoff = "2026-08-17T00:00:00.000Z";

    it("deletes fully stale versions and rewrites mixed ones", () => {
        const plan = planIpcLogPrune(
            [
                {
                    version: "old",
                    records: [{ ts: "2026-08-01T00:00:00.000Z" }],
                },
                {
                    version: "mix",
                    records: [
                        { ts: "2026-08-01T00:00:00.000Z" },
                        { ts: "2026-08-20T00:00:00.000Z" },
                    ],
                },
            ],
            cutoff,
        );
        expect(plan.dropped).toBe(2);
        expect(plan.kept.map((r) => r.ts)).toEqual(["2026-08-20T00:00:00.000Z"]);
        expect(plan.rewrite).toBe(true);
        expect(plan.deleteAll).toBe(false);
        expect(plan.deleteVersions).toEqual(["old"]);
    });

    it("marks deleteAll when nothing is newer than the cutoff", () => {
        const plan = planIpcLogPrune(
            [{ version: "v1", records: [{ ts: "2026-08-01T00:00:00.000Z" }] }],
            cutoff,
        );
        expect(plan.deleteAll).toBe(true);
        expect(plan.kept).toEqual([]);
    });

    it("flattens a large live version without overflowing the stack", () => {
        const records = Array.from({ length: 120_000 }, (_, i) => ({
            ts: `2026-08-20T00:00:${String(i % 60).padStart(2, "0")}.000Z`,
        }));
        const plan = planIpcLogPrune([{ version: "huge", records }], cutoff);
        expect(plan.kept).toHaveLength(120_000);
        expect(plan.rewrite).toBe(false);
    });

    it("rewrites a version that is missing a chunk", () => {
        const plan = planIpcLogPrune(
            [{ version: "gap", records: [{ ts: "2026-08-20T00:00:00.000Z" }], missingChunks: 1 }],
            cutoff,
        );
        expect(plan.rewrite).toBe(true);
        expect(plan.deleteVersions).toEqual([]);
    });

    it("treats unreadable versions as empty so they are deleted", () => {
        const plan = planIpcLogPrune(
            [
                { version: "corrupt", records: [] },
                { version: "live", records: [{ ts: "2026-08-20T00:00:00.000Z" }] },
            ],
            cutoff,
        );
        expect(plan.deleteVersions).toEqual(["corrupt"]);
        expect(plan.kept.map((r) => r.ts)).toEqual(["2026-08-20T00:00:00.000Z"]);
        expect(plan.deleteAll).toBe(false);
    });
});

describe("pruneIpcLogsOlderThan", () => {
    const tmpDirs = [];
    afterEach(() => {
        for (const dir of tmpDirs.splice(0)) {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it("skips a truncated chunk and keeps pruning other versions", async () => {
        const tmpDir = mkdtempSync(join(tmpdir(), "ipc-prune-"));
        tmpDirs.push(tmpDir);
        const params = {
            tasksLogsBasePath: tmpDir,
            tasksLogsNamespace: "tasks-logs",
        };
        const logger = { warn: vi.fn(), info: vi.fn() };
        const fd = new FileDatabase({
            basePath: tmpDir,
            namespace: "tasks-logs",
            tableName: "runner",
            versioned: true,
            useMetadata: true,
            maxVersions: 30,
            pageSize: 2000,
            logger,
        });
        await fd.write([{ ts: "2026-08-01T00:00:00.000Z", msg: "old" }], { forceNewVersion: true });
        const [staleVersion] = await fd.getVersions();
        await fd.write([{ ts: "2026-08-20T00:00:00.000Z", msg: "live" }], { forceNewVersion: true });

        const staleDir = join(tmpDir, "tasks-logs", "runner", staleVersion);
        const chunk = readdirSync(staleDir).find((name) => name.endsWith(".json") && name !== "metadata.json");
        expect(chunk).toBeTruthy();
        const chunkPath = join(staleDir, chunk);
        writeFileSync(chunkPath, '[{"ts":"2026-08-01T00:00:00.000Z"', "utf8");
        const staleAt = Date.now() - 30_000;
        utimesSync(chunkPath, staleAt / 1000, staleAt / 1000);

        const ctx = {
            logger,
            params: { get: (key) => params[key] },
        };
        const out = await pruneIpcLogsOlderThan(ctx, "2026-08-17T00:00:00.000Z");
        expect(out.tables).toBe(1);
        expect(out.details[0].error).toBeUndefined();
        expect(logger.warn).toHaveBeenCalled();
        expect(String(logger.warn.mock.calls[0][0])).toMatch(/unreadable IPC log runner/);

        const remaining = (await fd.getVersions()).filter((v) => {
            try {
                readdirSync(join(tmpDir, "tasks-logs", "runner", v));
                return true;
            } catch {
                return false;
            }
        });
        expect(remaining).not.toContain(staleVersion);
        expect(remaining.length).toBeGreaterThanOrEqual(1);
        const kept = await fd.read({ version: remaining[remaining.length - 1] });
        expect(kept.some((r) => r.msg === "live")).toBe(true);
    });

    it("skips a missing chunk file and still prunes the table", async () => {
        const tmpDir = mkdtempSync(join(tmpdir(), "ipc-prune-missing-"));
        tmpDirs.push(tmpDir);
        const params = {
            tasksLogsBasePath: tmpDir,
            tasksLogsNamespace: "tasks-logs",
        };
        const logger = { warn: vi.fn(), info: vi.fn() };
        const fd = new FileDatabase({
            basePath: tmpDir,
            namespace: "tasks-logs",
            tableName: "bright/intake",
            versioned: true,
            useMetadata: true,
            maxVersions: 30,
            pageSize: 10,
            logger,
        });
        await fd.write(
            Array.from({ length: 25 }, (_, i) => ({
                ts: `2026-08-20T00:00:${String(i).padStart(2, "0")}.000Z`,
                n: i,
            })),
            { forceNewVersion: true },
        );
        const [version] = await fd.getVersions();
        const versionDir = join(tmpDir, "tasks-logs", "bright", "intake", version);
        const chunk = readdirSync(versionDir).find((name) => name === "000002.json");
        expect(chunk).toBeTruthy();
        rmSync(join(versionDir, chunk));

        const ctx = {
            logger,
            params: { get: (key) => params[key] },
        };
        const out = await pruneIpcLogsOlderThan(ctx, "2026-08-17T00:00:00.000Z");
        expect(out.tables).toBe(1);
        expect(out.details[0].error).toBeUndefined();
        expect(logger.warn.mock.calls.map((c) => String(c[0])).join("\n")).not.toMatch(
            /skipping unreadable IPC log/,
        );

        const fd2 = new FileDatabase({
            basePath: tmpDir,
            namespace: "tasks-logs",
            tableName: "bright/intake",
            versioned: true,
            useMetadata: true,
            pageSize: 10,
            logger,
        });
        const remaining = await fd2.getVersions();
        expect(remaining.length).toBeGreaterThanOrEqual(1);
        const kept = await fd2.read({ version: remaining[remaining.length - 1] });
        expect(fd2.lastReadMissingFiles ?? []).toEqual([]);
        expect(kept.length).toBeGreaterThan(0);
        const healedDir = join(tmpDir, "tasks-logs", "bright", "intake", remaining[remaining.length - 1]);
        const onDisk = readdirSync(healedDir);
        for (const file of fd2.getMetadata().files ?? []) {
            expect(onDisk).toContain(file.fileName);
        }
    });
});

describe("deleteHistoryOlderThan", () => {
    it("deletes in chunks and stops when a chunk is short", async () => {
        const batches = [
            [{ id: "a" }, { id: "b" }],
            [{ id: "c" }],
        ];
        let calls = 0;
        const deleted = [];
        const db = (table) => {
            expect(table).toBe("tasks_history");
            return {
                where: () => ({
                    select: () => ({
                        limit: async () => batches[calls++] ?? [],
                    }),
                }),
                whereIn: (_col, ids) => ({
                    delete: async () => {
                        deleted.push(...ids);
                        return ids.length;
                    },
                }),
            };
        };
        const n = await deleteHistoryOlderThan(db, "tasks_history", "2026-08-17T00:00:00.000Z", {
            chunkSize: 2,
        });
        expect(n).toBe(3);
        expect(deleted).toEqual(["a", "b", "c"]);
    });
});

describe("pruneTaskRetention", () => {
    function makeContext() {
        const deleted = [];
        const db = (table) => ({
            where: () => ({
                select: () => ({
                    limit: async () => {
                        if (deleted.length) return [];
                        return [{ id: "old" }];
                    },
                }),
            }),
            whereIn: (_col, ids) => ({
                delete: async () => {
                    deleted.push(...ids);
                    return ids.length;
                },
            }),
        });
        return {
            db,
            tasksQueueName: "tasks",
            logger: { info: vi.fn(), warn: vi.fn() },
            params: {
                get: () => undefined,
                getAllForModule: (_m, defs) => ({
                    tasksRetentionEnabled: true,
                    tasksRetentionDays: 7,
                    tasksRetentionIntervalMs: 3_600_000,
                    tasksRetentionMinFreeRatio: 0.1,
                    tasksRetentionMinHours: 6,
                    ...Object.fromEntries(
                        Object.entries(defs).map(([k, spec]) => {
                            if (String(spec).includes("default 7")) return [k, 7];
                            return [k, undefined];
                        }),
                    ),
                }),
            },
            isStop: () => false,
            deleted,
        };
    }

    it("applies the same cutoff to history and logs", async () => {
        const ctx = makeContext();
        const logCuts = [];
        const now = new Date("2026-08-24T12:00:00.000Z");
        const out = await pruneTaskRetention(ctx, {
            now,
            readDisk: async () => ({ free: 90, total: 100, freeRatio: 0.9 }),
            pruneLogs: async (_c, cutoff) => {
                logCuts.push(cutoff);
                return { tables: 2, dropped: 4, details: [] };
            },
        });
        expect(out.skipped).toBe(false);
        expect(out.cutoff).toBe("2026-08-17T12:00:00.000Z");
        expect(logCuts).toEqual(["2026-08-17T12:00:00.000Z"]);
        expect(out.historyDeleted).toBe(1);
        expect(out.logs.dropped).toBe(4);
        expect(ctx.deleted).toEqual(["old"]);
    });

    it("uses getDiskUsage when readDisk is not injected", async () => {
        const ctx = makeContext();
        const out = await pruneTaskRetention(ctx, {
            now: new Date("2026-08-24T12:00:00.000Z"),
            pruneLogs: async () => ({ tables: 0, dropped: 0, details: [] }),
        });
        expect(out.skipped).toBe(false);
        expect(out.error).toBeUndefined();
        expect(out.cutoff).toMatch(/^2026-08-/);
    });

    it("maybePrune skips when inside the interval", async () => {
        const ctx = makeContext();
        seedTaskRetentionRuntime(ctx);
        ctx.tasksRuntime.tasksRetentionIntervalMs = 60_000;
        ctx.__tasksRetentionLastAt = Date.now();
        const first = await maybePruneTaskRetention(ctx, {
            readDisk: async () => null,
            pruneLogs: async () => ({ tables: 0, dropped: 0, details: [] }),
        });
        expect(first).toBeNull();
    });
});

describe("retention runtime coerce", () => {
    it("accepts days 0 and a free-ratio fraction", () => {
        expect(coerceRuntimeValue("tasksRetentionDays", 0)).toBe(0);
        expect(coerceRuntimeValue("tasksRetentionDays", "14")).toBe(14);
        expect(coerceRuntimeValue("tasksRetentionMinFreeRatio", 0.05)).toBe(0.05);
        expect(coerceRuntimeValue("tasksRetentionEnabled", "false")).toBe(false);
    });
});
