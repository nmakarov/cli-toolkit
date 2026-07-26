import { describe, it, expect, vi } from "vitest";
import { createTaskProgressReporter } from "../taskUtils.js";

describe("createTaskProgressReporter", () => {
    it("coalesces in-flight updates to the latest value", async () => {
        const updates = [];
        let releaseFirst;
        const firstGate = new Promise((resolve) => {
            releaseFirst = resolve;
        });

        const context = {
            logger: { warn: vi.fn() },
            db: Object.assign(
                (table) => ({
                    where: () => ({
                        update: async (row) => {
                            updates.push({ table, ...row });
                            if (updates.length === 1) await firstGate;
                        },
                    }),
                }),
                { _instance: {} }
            ),
        };

        // getDb expects context.db callable with _instance — match production proxy shape
        context.db._instance = { knexInstance: true };

        const report = createTaskProgressReporter(context, "tasks", "t1");

        const p1 = report("1/10");
        const p2 = report("2/10");
        const p3 = report("3/10");

        releaseFirst();
        await Promise.all([p1, p2, p3]);

        expect(updates.map((u) => u.progress)).toEqual(["1/10", "3/10"]);
    });
});
