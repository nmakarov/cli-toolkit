import { describe, it, expect } from "vitest";
import { taskHistoryInsertFromQueueRow } from "../taskUtils.js";
import { waitForTaskResult } from "../index.js";

describe("taskHistoryInsertFromQueueRow", () => {
    it("stamps queue id into opid when enqueue had no opid", () => {
        const payload = taskHistoryInsertFromQueueRow(
            { id: "queue-uuid", name: "hostInfo", opid: null, params: null },
            { success: true, completed_at: new Date() },
        );
        expect(payload.id).toBeUndefined();
        expect(payload.opid).toBe("queue-uuid");
        expect(payload.name).toBe("hostInfo");
        expect(payload.success).toBe(true);
    });

    it("keeps an explicit opid", () => {
        const payload = taskHistoryInsertFromQueueRow(
            { id: "queue-uuid", name: "hostInfo", opid: "batch-1" },
            { success: true },
        );
        expect(payload.opid).toBe("batch-1");
    });

    it("lets overrides.opid win", () => {
        const payload = taskHistoryInsertFromQueueRow(
            { id: "queue-uuid", name: "hostInfo", opid: null },
            { opid: "forced" },
        );
        expect(payload.opid).toBe("forced");
    });
});

describe("waitForTaskResult fast-complete race", () => {
    it("finds history when queue row is already gone on first poll", async () => {
        const taskId = "fast-task-id";
        const historyRow = {
            id: "new-history-id",
            name: "hostInfo",
            opid: taskId,
            success: true,
            completed_at: new Date(),
        };

        const makeHistoryQuery = () => {
            const filters = {};
            const api = {
                where(...args) {
                    if (args.length === 1 && args[0] && typeof args[0] === "object") {
                        Object.assign(filters, args[0]);
                    } else if (args.length >= 1 && typeof args[0] === "string") {
                        // where("completed_at", ">=", date) — ignore for match
                        filters[args[0]] = args[2];
                    }
                    return api;
                },
                whereNull(col) {
                    filters[col] = null;
                    return api;
                },
                orderBy() {
                    return api;
                },
                async first() {
                    if (filters.id === taskId) return undefined;
                    if (filters.opid === taskId) return historyRow;
                    return undefined;
                },
            };
            return api;
        };

        const db = Object.assign(
            (table) => {
                if (table === "tasks") {
                    return {
                        where: () => ({
                            first: async () => null,
                        }),
                    };
                }
                if (table === "tasks_history") {
                    return makeHistoryQuery();
                }
                throw new Error(`unexpected table ${table}`);
            },
            { config: { name: "test" } },
        );

        const done = await waitForTaskResult({ db }, taskId, {
            timeoutMs: 2_000,
            pollMs: 20,
            name: "hostInfo",
        });

        expect(done).toEqual(historyRow);
    });
});
