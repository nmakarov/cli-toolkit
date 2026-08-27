import { describe, expect, it, vi } from "vitest";
import { signalStopForDeletedQueueRows } from "../index.js";

describe("signalStopForDeletedQueueRows", () => {
    it("requestStop when a running task's queue row is gone", async () => {
        const requestStop = vi.fn();
        const stillThere = vi.fn();
        const running = new Map([
            ["gone", { requestStop }],
            ["alive", { requestStop: stillThere }],
        ]);
        const db = (table) => {
            expect(table).toBe("tasks");
            return {
                whereIn: () => ({
                    select: async () => [{ id: "alive" }],
                }),
            };
        };
        const logger = { warn: vi.fn() };
        await signalStopForDeletedQueueRows({ db, logger }, "tasks", running);
        expect(requestStop).toHaveBeenCalledTimes(1);
        expect(stillThere).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/gone.*deleted/));
    });

    it("no-ops when the map is empty", async () => {
        const db = vi.fn();
        await signalStopForDeletedQueueRows({ db }, "tasks", new Map());
        expect(db).not.toHaveBeenCalled();
    });
});
