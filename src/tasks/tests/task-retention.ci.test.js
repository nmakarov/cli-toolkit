import { describe, it, expect, vi } from "vitest";
import {
    deleteHistoryOlderThan,
    effectiveRetentionDays,
    maybePruneTaskRetention,
    pruneTaskRetention,
    readRetentionConfig,
    retentionCutoffIso,
    seedTaskRetentionRuntime,
} from "../taskRetention.js";
import { planIpcLogPrune } from "../taskLogs.js";
import { coerceRuntimeValue } from "../runtimeParams.js";

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
