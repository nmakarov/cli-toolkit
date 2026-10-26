import { describe, expect, it } from "vitest";

import { AbstractTask } from "../AbstractTask.js";
import { runTasksLoop } from "../index.js";
import { TasksRegistry } from "../TasksRegistry.js";

class WorkTask extends AbstractTask {
    static taskName = "work";

    async run() {
        workRuns += 1;
        return { success: true, results: { message: "ran" } };
    }
}

let workRuns = 0;
let lastRow = null;

function queueRow(name, id) {
    return {
        id,
        name,
        status: "idle",
        params: {},
        schedule: null,
        past_due: null,
        next_run_at: null,
        priority: 50,
    };
}

function fakeDb({ onNames }) {
    function builder() {
        const b = {
            _names: null,
            where(...args) {
                if (typeof args[0] === "function") args[0].call(b);
                return b;
            },
            whereIn(col, vals) {
                if (col === "name") b._names = vals;
                return b;
            },
            whereNotIn() {
                return b;
            },
            whereNull() {
                return b;
            },
            orWhere() {
                return b;
            },
            limit() {
                return b;
            },
            orderBy() {
                return b;
            },
            orderByRaw() {
                return b;
            },
            select() {
                return Promise.resolve([]);
            },
            first() {
                return Promise.resolve(undefined);
            },
            insert() {
                return Promise.resolve([1]);
            },
            delete() {
                return Promise.resolve(1);
            },
            update() {
                const row = lastRow;
                return {
                    returning: () => Promise.resolve(row ? [{ ...row, status: "running" }] : []),
                };
            },
            then(resolve, reject) {
                const rows = onNames(b._names);
                if (rows[0]) lastRow = rows[0];
                return Promise.resolve(rows).then(resolve, reject);
            },
        };
        return b;
    }
    builder.fn = { now: () => new Date() };
    return builder;
}

function contextFor(db) {
    return {
        db,
        isStop() {
            return this.tasksRuntime?.paused === true;
        },
        tasksRuntime: { tasksRetentionEnabled: false },
        params: {
            getAllForModule: () => ({ tasksRetentionEnabled: false }),
            get: () => undefined,
        },
        logger: {
            info() {},
            warn() {},
            error() {},
            debug() {},
        },
        emitter: { emit() {} },
    };
}

describe("runTasksLoop pause", () => {
    it("pauses before claiming work when the pause is already waiting", async () => {
        workRuns = 0;
        const pause = queueRow("pauseRunner", "p1");
        const db = fakeDb({
            onNames(names) {
                if (names?.includes("pauseRunner")) return [pause];
                if (names?.includes("work")) return [queueRow("work", "w1")];
                return [];
            },
        });
        const registry = TasksRegistry.withCoreTasks().add("work", WorkTask);
        await runTasksLoop(contextFor(db), {
            target: "photocare",
            maxParallel: 4,
            pollMs: 5,
            registry,
            allowedTasks: ["work"],
        });
        expect(workRuns).toBe(0);
    });

    it("stops a refill on the next claim after pause arrives", async () => {
        workRuns = 0;
        let immediatePolls = 0;
        const db = fakeDb({
            onNames(names) {
                if (names?.includes("pauseRunner")) {
                    immediatePolls += 1;
                    if (immediatePolls >= 3) return [queueRow("pauseRunner", "p1")];
                    return [];
                }
                if (names?.includes("work")) return [queueRow("work", `w${workRuns + 1}`)];
                return [];
            },
        });
        const registry = TasksRegistry.withCoreTasks().add("work", WorkTask);
        await runTasksLoop(contextFor(db), {
            target: "photocare",
            maxParallel: 4,
            pollMs: 5,
            registry,
            allowedTasks: ["work"],
        });
        expect(workRuns).toBe(1);
    });
});
