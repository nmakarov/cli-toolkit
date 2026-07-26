import { describe, it, expect, vi, beforeEach } from "vitest";
import { ParamError } from "../../errors.js";
import {
    TaskPauseRunner,
    TaskUnpauseRunner,
    applyRunnerPaused,
} from "../coreTasks/TaskPauseRunner.js";
import { TasksRegistry } from "../TasksRegistry.js";
import { ensureTasksRuntime } from "../runtimeParams.js";
import { SERVICE_TASK_NAMES } from "../serviceTaskAllowlist.js";

function makeContext(overrides = {}) {
    return {
        tasksRuntime: undefined,
        servicesRegistry: undefined,
        logger: {
            warn: vi.fn(),
            info: vi.fn(),
        },
        params: {
            getAllForModule: () => ({}),
            get: () => undefined,
        },
        ...overrides,
    };
}

describe("pause / unpause runner", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("registers aliases on withCoreTasks", () => {
        const reg = TasksRegistry.withCoreTasks();
        expect(reg.get("pauseRunner")).toBe(TaskPauseRunner);
        expect(reg.get("pause")).toBe(TaskPauseRunner);
        expect(reg.get("unpauseRunner")).toBe(TaskUnpauseRunner);
        expect(reg.get("unpause")).toBe(TaskUnpauseRunner);
    });

    it("includes pause names in SERVICE_TASK_NAMES", () => {
        expect(SERVICE_TASK_NAMES).toEqual(
            expect.arrayContaining(["pause", "pauseRunner", "unpause", "unpauseRunner"])
        );
    });

    it("resolveParams requires serviceName", async () => {
        const ctx = makeContext();
        await expect(TaskPauseRunner.resolveParams(ctx, {})).rejects.toBeInstanceOf(ParamError);
        await expect(TaskUnpauseRunner.resolveParams(ctx, {})).rejects.toBeInstanceOf(ParamError);
    });

    it("applyRunnerPaused toggles tasksRuntime.paused", async () => {
        const ctx = makeContext();
        ensureTasksRuntime(ctx, {});
        expect(ctx.tasksRuntime.paused).toBe(false);

        const paused = await applyRunnerPaused(ctx, true);
        expect(paused.success).toBe(true);
        expect(paused.results.paused).toBe(true);
        expect(ctx.tasksRuntime.paused).toBe(true);

        const again = await applyRunnerPaused(ctx, true);
        expect(again.results.message).toMatch(/already paused/i);

        const unpaused = await applyRunnerPaused(ctx, false);
        expect(unpaused.results.paused).toBe(false);
        expect(ctx.tasksRuntime.paused).toBe(false);
    });

    it("TaskPauseRunner / TaskUnpauseRunner run() flip paused flag", async () => {
        const ctx = makeContext();
        ensureTasksRuntime(ctx, {});
        const pauseTask = new TaskPauseRunner(ctx, { id: "p1", params: {} });
        await pauseTask.run();
        expect(ctx.tasksRuntime.paused).toBe(true);

        const unpauseTask = new TaskUnpauseRunner(ctx, { id: "u1", params: {} });
        await unpauseTask.run();
        expect(ctx.tasksRuntime.paused).toBe(false);
    });
});
