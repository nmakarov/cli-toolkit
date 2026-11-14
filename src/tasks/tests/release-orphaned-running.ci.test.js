import { describe, expect, it, vi } from "vitest";

import { releaseOrphanedRunningTasks } from "../index.js";

function fakeDb(rows) {
    const updates = [];
    const db = () => {
        const state = { filters: {}, ids: null };
        const b = {
            where(arg) {
                Object.assign(state.filters, arg);
                return b;
            },
            whereIn(_col, ids) {
                state.ids = ids;
                return b;
            },
            select() {
                return Promise.resolve(
                    rows.filter((row) =>
                        Object.entries(state.filters).every(([key, value]) => row[key] === value),
                    ),
                );
            },
            update(patch) {
                updates.push({ ids: state.ids, patch });
                return Promise.resolve(state.ids?.length ?? 0);
            },
        };
        return b;
    };
    db.fn = { now: () => "now" };
    return { db, updates };
}

const identity = {
    service_name: "photocare-host-5",
    server_name: "v2photos5",
    instance_number: 5,
};

describe("releaseOrphanedRunningTasks", () => {
    it("returns running tasks a restarted worker still holds to idle", async () => {
        const { db, updates } = fakeDb([
            {
                id: "a",
                name: "processListingPhotos",
                status: "running",
                service_name: "photocare-host-5",
                server_name: "v2photos5",
                instance_number: 5,
            },
            {
                id: "b",
                name: "processListingPhotos",
                status: "running",
                service_name: "photocare-other",
                server_name: "v2photos1",
                instance_number: 1,
            },
        ]);
        const logger = { warn: vi.fn() };
        const ids = await releaseOrphanedRunningTasks(
            { db, logger },
            "tasks",
            identity,
        );
        expect(ids).toEqual(["a"]);
        expect(updates).toHaveLength(1);
        expect(updates[0].ids).toEqual(["a"]);
        expect(updates[0].patch.status).toBe("idle");
        expect(updates[0].patch.service_name).toBeNull();
        expect(JSON.parse(updates[0].patch.progress).message).toMatch(/queued again/);
        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining("released 1 running task"),
        );
    });

    it("does nothing when this worker holds no running tasks", async () => {
        const { db, updates } = fakeDb([]);
        const ids = await releaseOrphanedRunningTasks({ db, logger: { warn: vi.fn() } }, "tasks", identity);
        expect(ids).toEqual([]);
        expect(updates).toHaveLength(0);
    });
});
