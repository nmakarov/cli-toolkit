import { afterEach, describe, expect, it, vi } from "vitest";
import {
    parseRetentionNameRulesRaw,
    resolveRetentionNameRules,
    setTaskRetentionNameRulesDefaults,
} from "../taskRetentionNameRules.js";
import {
    deleteHistoryOlderThan,
    pruneTaskRetention,
    retentionCutoffFromHours,
} from "../taskRetention.js";

afterEach(() => {
    setTaskRetentionNameRulesDefaults(null);
});

describe("taskRetentionNameRules", () => {
    it("merges injected defaults with runtime JSON overrides", () => {
        setTaskRetentionNameRulesDefaults({ processListingPhotos: 12, ping: 1 });
        expect(
            resolveRetentionNameRules({
                tasksRetentionNameRules: '{"processListingPhotos":24,"harvest":6}',
            }),
        ).toEqual([
            { name: "harvest", hours: 6 },
            { name: "ping", hours: 1 },
            { name: "processListingPhotos", hours: 24 },
        ]);
    });

    it("parses invalid JSON as empty", () => {
        expect(parseRetentionNameRulesRaw("{bad")).toEqual({});
    });

    it("retentionCutoffFromHours subtracts wall-clock hours", () => {
        const now = new Date("2026-09-03T12:00:00.000Z");
        expect(retentionCutoffFromHours(12, now)).toBe("2026-09-03T00:00:00.000Z");
    });
});

describe("deleteHistoryOlderThan name filter", () => {
    it("deletes only rows for the given task name", async () => {
        const deleted = [];
        const db = (table) => {
            expect(table).toBe("tasks_history");
            let nameFilter = null;
            const chain = {
                where(col, op) {
                    if (typeof col === "object" && col?.name) nameFilter = col.name;
                    if (col === "completed_at") expect(op).toBe("<");
                    return chain;
                },
                select: () => ({
                    limit: async () => {
                        if (nameFilter !== "processListingPhotos") return [];
                        if (deleted.length) return [];
                        return [{ id: "p1" }, { id: "p2" }];
                    },
                }),
            };
            return {
                ...chain,
                whereIn: (_col, ids) => ({
                    delete: async () => {
                        deleted.push(...ids);
                        return ids.length;
                    },
                }),
            };
        };
        const n = await deleteHistoryOlderThan(db, "tasks_history", "2026-09-03T00:00:00.000Z", {
            name: "processListingPhotos",
        });
        expect(n).toBe(2);
        expect(deleted).toEqual(["p1", "p2"]);
    });
});

describe("pruneTaskRetention name rules", () => {
    it("runs per-name cutoffs after the global window", async () => {
        setTaskRetentionNameRulesDefaults({ processListingPhotos: 12 });
        const calls = [];
        const makeChain = () => {
            let nameFilter = null;
            const chain = {
                where(col, op, val) {
                    if (typeof col === "object" && col?.name) {
                        nameFilter = col.name;
                        calls.push({ kind: "name", name: col.name, cutoff: val });
                    } else if (col === "completed_at") {
                        calls.push({ kind: "global", cutoff: val });
                    }
                    return chain;
                },
                select: () => ({
                    limit: async () => [],
                }),
            };
            return chain;
        };
        const db = () => ({
            ...makeChain(),
            whereIn: () => ({ delete: async () => 0 }),
        });
        const ctx = {
            db,
            tasksQueueName: "tasks",
            tasksRuntime: {},
            logger: { info: vi.fn(), warn: vi.fn() },
            params: {
                get: () => undefined,
                getAllForModule: (_m, defs) =>
                    Object.fromEntries(
                        Object.keys(defs).map((k) => [k, k === "tasksRetentionDays" ? 7 : undefined]),
                    ),
            },
            isStop: () => false,
        };
        const now = new Date("2026-09-03T12:00:00.000Z");
        await pruneTaskRetention(ctx, {
            now,
            readDisk: async () => ({ free: 90, total: 100, freeRatio: 0.9 }),
            pruneLogs: async () => ({ tables: 0, dropped: 0, details: [] }),
        });
        expect(calls.some((c) => c.kind === "global")).toBe(true);
        expect(calls.some((c) => c.kind === "name" && c.name === "processListingPhotos")).toBe(true);
    });
});
