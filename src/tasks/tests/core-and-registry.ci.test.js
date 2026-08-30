import { describe, expect, it, vi } from "vitest";
import { ParamError } from "../../errors.js";
import { AbstractTask } from "../AbstractTask.js";
import { TasksRegistry } from "../TasksRegistry.js";
import { TaskPing } from "../coreTasks/TaskPing.js";
import { TaskSumAB } from "../coreTasks/TaskSumAB.js";
import { TaskSampleProcess } from "../coreTasks/TaskSampleProcess.js";
import { TaskShellCommand } from "../coreTasks/TaskShellCommand.js";
import { TaskSystemInfo } from "../coreTasks/TaskSystemInfo.js";
import { TaskStopRunner } from "../coreTasks/TaskStopRunner.js";
import { applyRunnerPaused, TaskPauseRunner } from "../coreTasks/TaskPauseRunner.js";
import { TaskSetRuntimeParam } from "../coreTasks/TaskSetRuntimeParam.js";
import { TaskGetLogs } from "../coreTasks/TaskGetLogs.js";
import { TaskPruneTaskRetention } from "../coreTasks/TaskPruneTaskRetention.js";
import {
    SERVICE_TASK_NAMES,
    normalizeAllowedTasks,
    mergeAllowedTasksWithServiceTasks,
} from "../serviceTaskAllowlist.js";

function paramsFrom(values = {}) {
    return {
        get: (key) => values[key],
        getAllForModule: (_mod, defs = {}) => {
            const out = {};
            for (const [k, spec] of Object.entries(defs)) {
                if (k in values) {
                    out[k] = values[k];
                    continue;
                }
                if (typeof spec === "string" && spec.includes("default ")) {
                    const def = spec.split("default ")[1];
                    if (spec.startsWith("number")) out[k] = Number(def);
                    else if (spec.startsWith("boolean")) out[k] = def === "true";
                    else out[k] = def;
                }
            }
            return out;
        },
    };
}

describe("AbstractTask", () => {
    it("defaults, stop/pause flags, and resolveParams", async () => {
        const t = new AbstractTask({ logger: {} }, { id: "1" });
        expect(t.cantRunReason()).toBe(false);
        expect(t.isStopRequested()).toBe(false);
        t.requestStop();
        t.requestPause();
        expect(t.isStopRequested()).toBe(true);
        expect(t.isPauseRequested()).toBe(true);
        await expect(t.run()).rejects.toThrow(/must be implemented/);

        const ctx = { params: paramsFrom({ name: "ping", priority: 10, serviceGroup: "alpha" }) };
        const payload = await AbstractTask.resolveParams(ctx, { opid: "op-1" });
        expect(payload).toMatchObject({ name: "ping", priority: 10, serviceGroup: "alpha", opid: "op-1" });
        await expect(AbstractTask.resolveParams({ params: paramsFrom({}) })).rejects.toBeInstanceOf(ParamError);
        await expect(
            AbstractTask.resolveParams({ params: paramsFrom({ name: "ping", instanceNumber: 0 }) }),
        ).rejects.toBeInstanceOf(ParamError);
        await expect(
            AbstractTask.resolveParams({ params: paramsFrom({ name: "ping", priority: "x" }) }),
        ).rejects.toBeInstanceOf(ParamError);

        expect(await AbstractTask.resolveCustomParams({ params: paramsFrom({}) })).toBe(null);
        expect(
            await AbstractTask.resolveCustomParams(
                { params: paramsFrom({ paramsJson: '{"a":1}' }) },
                { params: { b: 2 } },
            ),
        ).toEqual({ a: 1, b: 2 });
        expect(() =>
            AbstractTask._defaultParamsBlob({ params: paramsFrom({ paramsJson: "[]" }) }),
        ).toThrow(ParamError);
        expect(() =>
            AbstractTask._defaultParamsBlob({ params: paramsFrom({ paramsJson: "{bad" }) }),
        ).toThrow(ParamError);
        expect(AbstractTask._mergeTypedParams({ params: paramsFrom({ a: 1 }) }, "m", { a: "number" }, { params: { a: 9 } })).toEqual({
            a: 9,
        });
    });
});

describe("TasksRegistry", () => {
    it("add/get/require/resolve and withCoreTasks aliases", async () => {
        const extra = new TasksRegistry({ custom: TaskPing });
        extra.addMany({ other: TaskSumAB });
        expect(extra.get("custom")).toBe(TaskPing);
        expect(extra.listSupportedTasks()).toContain("other");
        expect(extra.toObject().custom).toBe(TaskPing);
        expect(() => extra.requireClass("nope")).toThrow(ParamError);

        const reg = TasksRegistry.withCoreTasks();
        expect(reg.get("stop")).toBe(TaskStopRunner);
        expect(reg.get("info")).toBe(TaskSystemInfo);
        const ctx = { params: paramsFrom({ name: "ping" }) };
        const payload = await reg.resolveTaskParams(ctx);
        expect(payload.name).toBe("ping");
        await expect(reg.resolveTaskParams({ params: paramsFrom({}) })).rejects.toBeInstanceOf(ParamError);
    });
});

describe("core tasks", () => {
    it("TaskPing / TaskSumAB / TaskSystemInfo / TaskStopRunner", async () => {
        const logger = { info: vi.fn(), warn: vi.fn() };
        expect(await new TaskPing({ logger }, { id: "p1" }).run()).toEqual({
            success: true,
            results: "pong",
        });
        expect(await TaskPing.resolveCustomParams()).toBe(null);

        const sumCtx = { params: paramsFrom({ a: 2, b: 3, name: "taskSumAB" }) };
        expect(await TaskSumAB.resolveCustomParams(sumCtx)).toEqual({ a: 2, b: 3 });
        await expect(TaskSumAB.resolveCustomParams({ params: paramsFrom({ a: "x", b: 1 }) })).rejects.toBeInstanceOf(
            ParamError,
        );
        expect(await new TaskSumAB({ logger }, { id: "s", params: { a: 2, b: 3 } }).run()).toEqual({
            success: true,
            results: { a: 2, b: 3, sum: 5 },
        });
        expect((await new TaskSumAB({ logger }, { id: "s", params: { a: "x", b: 1 } }).run()).success).toBe(false);

        const info = await new TaskSystemInfo({ logger }, { id: "i" }).run();
        expect(info.success).toBe(true);
        expect(info.results.runtime.hostname).toBeTruthy();
        expect(await TaskSystemInfo.resolveCustomParams()).toBe(null);

        const stopCtx = { params: paramsFrom({ name: "stopRunner", serviceName: "host-1" }) };
        const stopPayload = await TaskStopRunner.resolveParams(stopCtx);
        expect(stopPayload.serviceName).toBe("host-1");
        await expect(
            TaskStopRunner.resolveParams({ params: paramsFrom({ name: "stopRunner" }) }),
        ).rejects.toBeInstanceOf(ParamError);
        expect((await new TaskStopRunner({ logger }, { params: { allowanceMs: 10 } }).run()).results.stopRunner).toBe(
            true,
        );
    });

    it("TaskSampleProcess ticks, honors stop, and validates", async () => {
        const logger = { info: vi.fn(), warn: vi.fn(), progress: vi.fn() };
        const ctx = { params: paramsFrom({ name: "sampleProcess", total: 2, delay: 0 }) };
        expect(await TaskSampleProcess.resolveCustomParams(ctx)).toMatchObject({ total: 2, delay: 0 });
        await expect(
            TaskSampleProcess.resolveCustomParams({ params: paramsFrom({ total: 0, delay: 0 }) }),
        ).rejects.toBeInstanceOf(ParamError);

        const reports = [];
        const ok = new TaskSampleProcess({ logger }, { id: "sp", params: { total: 2, delay: 0, name: "demo" } });
        const done = await ok.run(async (p) => reports.push(p));
        expect(done.success).toBe(true);
        expect(reports).toHaveLength(2);

        const stopping = new TaskSampleProcess({ logger }, { id: "sp2", params: { total: 5, delay: 10 } });
        stopping.requestStop(0);
        const stopped = await stopping.run(async () => {});
        expect(stopped.success).toBe(false);
        expect(stopped.results.completed).toBe(0);

        const bad = await new TaskSampleProcess({ logger }, { id: "sp3", params: { total: -1, delay: 0 } }).run(
            async () => {},
        );
        expect(bad.success).toBe(false);
    });

    it("TaskShellCommand runs a short command", async () => {
        const logger = { info: vi.fn(), warn: vi.fn() };
        const ctx = { params: paramsFrom({ name: "shellCommand", command: "echo hi" }) };
        expect(await TaskShellCommand.resolveCustomParams(ctx)).toEqual({ command: "echo hi" });
        await expect(
            TaskShellCommand.resolveCustomParams({ params: paramsFrom({ command: "" }) }),
        ).rejects.toBeInstanceOf(ParamError);
        const out = await new TaskShellCommand({ logger }, { params: { command: "echo hello-shell" } }).run();
        expect(out.success).toBe(true);
        expect(out.results.output).toContain("hello-shell");
        const fail = await new TaskShellCommand({ logger }, { params: { command: "exit 7" } }).run();
        expect(fail.success).toBe(false);
    });

    it("applyRunnerPaused and TaskSetRuntimeParam / TaskGetLogs validation", async () => {
        const logger = { warn: vi.fn(), info: vi.fn() };
        const context = { logger, tasksRuntime: { paused: false } };
        const first = await applyRunnerPaused(context, true);
        expect(first.results.paused).toBe(true);
        const again = await applyRunnerPaused(context, true);
        expect(again.results.message).toMatch(/already paused/);
        const un = await applyRunnerPaused(context, false);
        expect(un.results.paused).toBe(false);

        await expect(
            TaskPauseRunner.resolveParams({ params: paramsFrom({ name: "pauseRunner" }) }),
        ).rejects.toBeInstanceOf(ParamError);
        await expect(
            TaskSetRuntimeParam.resolveParams({ params: paramsFrom({ name: "setRuntimeParam" }) }),
        ).rejects.toBeInstanceOf(ParamError);
        const setCtx = {
            params: paramsFrom({
                name: "setRuntimeParam",
                serviceName: "host-1",
                paramKey: "maxParallel",
                paramValue: "4",
            }),
        };
        expect(await TaskSetRuntimeParam.resolveCustomParams(setCtx)).toEqual({ key: "maxParallel", value: 4 });
        await expect(
            TaskSetRuntimeParam.resolveCustomParams({
                params: paramsFrom({ name: "setRuntimeParam", serviceName: "host-1" }),
            }),
        ).rejects.toBeInstanceOf(ParamError);

        await expect(TaskGetLogs.resolveCustomParams({ params: paramsFrom({}) })).rejects.toBeInstanceOf(ParamError);
        const logs = await TaskGetLogs.resolveCustomParams({
            params: paramsFrom({
                source: "alpha",
                resource: "items",
                tail: 5,
                afterTs: "2026-01-01T00:00:00Z",
                fromTs: "2026-01-01T00:00:00Z",
                toTs: "2026-01-02T00:00:00Z",
                taskId: "t1",
            }),
        });
        expect(logs).toMatchObject({ source: "alpha", resource: "items", tail: 5, taskId: "t1" });

        const missing = await new TaskGetLogs({ logger }, { params: {} }).run();
        expect(missing.success).toBe(false);
        const boom = await new TaskGetLogs(
            {
                logger,
                harvestDataPath: "/no/such/path",
            },
            { params: { source: "alpha", resource: "items", tail: 2 } },
        ).run();
        expect(typeof boom.success).toBe("boolean");

        const setRun = await new TaskSetRuntimeParam(
            { logger, tasksRuntime: { maxParallel: 2 } },
            { params: { key: "maxParallel", value: 3 } },
        ).run();
        expect(setRun.success).toBe(true);
        expect(setRun.results.runtimeParamApplied).toBe(true);

        const pruned = await new TaskPruneTaskRetention(
            { logger, tasksRuntime: {}, harvestDataPath: "/tmp" },
            {},
        ).run();
        expect(pruned.success).toBe(true);

        const emptyShell = await new TaskShellCommand({ logger }, { params: { command: "" } }).run();
        expect(emptyShell.success).toBe(false);
        const strShell = await new TaskShellCommand({ logger }, { id: "sh", params: "echo as-string" }).run();
        expect(strShell.success).toBe(true);
        const badCwd = await new TaskShellCommand(
            { logger },
            { id: "sh2", params: { command: "echo hi", cwd: "/no/such/cli-tk-cwd" } },
        ).run();
        expect(badCwd.success).toBe(false);
    });
});

describe("serviceTaskAllowlist", () => {
    it("normalizes and merges control-lane names", () => {
        expect(normalizeAllowedTasks(undefined)).toBeUndefined();
        expect(normalizeAllowedTasks("  ")).toBeUndefined();
        expect(normalizeAllowedTasks("a, b")).toEqual(["a", "b"]);
        expect(normalizeAllowedTasks([" a ", "", "b"])).toEqual(["a", "b"]);
        expect(normalizeAllowedTasks([])).toBeUndefined();
        const merged = mergeAllowedTasksWithServiceTasks(["custom"]);
        expect(merged).toContain("ping");
        expect(merged).toContain("custom");
        expect(SERVICE_TASK_NAMES).toContain("pauseTask");
    });
});
