import { describe, expect, it, vi } from "vitest";
import { ParamError } from "../../errors.js";
import {
    TaskPauseTask,
    TaskResumeTask,
    applyPauseTask,
    applyResumeTask,
} from "../coreTasks/TaskPauseTask.js";
import { AbstractTask } from "../AbstractTask.js";
import { TasksRegistry } from "../TasksRegistry.js";
import { controlLaneTaskNames } from "../runtimeParams.js";
import { loggerTaskLabel } from "../taskUtils.js";

function makeDb(row) {
    const state = { row };
    const chain = {
        where: vi.fn(() => chain),
        first: vi.fn(async () => state.row),
        update: vi.fn(async (patch) => {
            state.row = { ...state.row, ...patch };
            return 1;
        }),
    };
    const db = vi.fn(() => chain);
    db.fn = { now: () => new Date() };
    return { db, state, chain };
}

describe("pauseTask / resumeTask", () => {
    it("registers on withCoreTasks and control lane", () => {
        const reg = TasksRegistry.withCoreTasks();
        expect(reg.get("pauseTask")).toBe(TaskPauseTask);
        expect(reg.get("resumeTask")).toBe(TaskResumeTask);
        expect(controlLaneTaskNames()).toContain("pauseTask");
        expect(controlLaneTaskNames()).toContain("resumeTask");
    });

    it("resolveCustomParams requires taskId", async () => {
        const ctx = {
            params: {
                get: () => undefined,
                getAllForModule: () => ({}),
            },
        };
        await expect(TaskPauseTask.resolveCustomParams(ctx, {})).rejects.toBeInstanceOf(ParamError);
        await expect(TaskResumeTask.resolveCustomParams(ctx, {})).rejects.toBeInstanceOf(ParamError);
    });

    it("applyPauseTask parks idle row as paused", async () => {
        const { db, state } = makeDb({
            id: "t1",
            name: "retroBackfill",
            status: "idle",
            progress: null,
        });
        const out = await applyPauseTask({ db, tasksQueueName: "tasks", logger: {} }, "t1");
        expect(out.success).toBe(true);
        expect(state.row.status).toBe("paused");
    });

    it("applyPauseTask signals in-process running instance", async () => {
        const { db } = makeDb({
            id: "t2",
            name: "retroBackfill",
            status: "running",
            progress: '{"phase":"harvesting"}',
        });
        const inst = new AbstractTask({}, { id: "t2" });
        const spy = vi.spyOn(inst, "requestPause");
        const map = new Map([["t2", inst]]);
        const out = await applyPauseTask(
            { db, tasksQueueName: "tasks", logger: {}, runningTaskInstances: map },
            "t2",
        );
        expect(out.success).toBe(true);
        expect(out.results.signaled).toBe(true);
        expect(spy).toHaveBeenCalled();
        expect(inst.isPauseRequested()).toBe(true);
    });

    it("applyResumeTask moves paused → idle", async () => {
        const { db, state } = makeDb({
            id: "t3",
            name: "retroBackfill",
            status: "paused",
            progress: { pauseRequested: true, pausedAt: "2026-01-01T00:00:00Z" },
            service_name: "host_a",
        });
        const out = await applyResumeTask({ db, tasksQueueName: "tasks", logger: {} }, "t3");
        expect(out.success).toBe(true);
        expect(state.row.status).toBe("idle");
        expect(state.row.service_name).toBe(null);
        expect(state.row.past_due).toBeInstanceOf(Date);
        expect(state.row.next_run_at).toBeInstanceOf(Date);
    });
});

describe("loggerTaskLabel", () => {
    it("tags the top-level task and source, not the leaf resource", () => {
        expect(loggerTaskLabel({ name: "retroBackfill", params: { source: "bright" } })).toBe(
            "retroBackfill:bright",
        );
        expect(
            loggerTaskLabel({
                name: "fetchByKeys",
                params: JSON.stringify({ source: "bright", resource: "media" }),
            }),
        ).toBe("fetchByKeys:bright");
        expect(loggerTaskLabel({ name: "hostInfo" })).toBe("hostInfo");
    });

    it("uses the parent logTask or intake opid on leaf rows", () => {
        expect(
            loggerTaskLabel({
                name: "loadHarvested",
                params: { source: "bright", resource: "media", logTask: "intakeCycle:bright" },
            }),
        ).toBe("intakeCycle:bright");
        expect(
            loggerTaskLabel({
                name: "loadHarvested",
                opid: "intake:bright:abc",
                params: { source: "bright", resource: "members" },
            }),
        ).toBe("intakeCycle:bright");
    });
});
