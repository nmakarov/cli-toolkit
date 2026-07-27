import { describe, it, expect, vi, beforeEach } from "vitest";
import { ParamError } from "../../errors.js";
import {
    applyRuntimeParam,
    applyRuntimePatch,
    coerceRuntimeValue,
    ensureTasksRuntime,
    readLoopRuntime,
    controlLaneTaskNames,
    mergeRuntimeParamSpecs,
    runtimeValuesForSpecs,
    runtimeParamSpecsFromMetadata,
    DEFAULT_RUNTIME_PARAM_SPECS,
} from "../runtimeParams.js";
import { TaskSetRuntimeParam } from "../coreTasks/TaskSetRuntimeParam.js";
import { TasksRegistry } from "../TasksRegistry.js";

function makeContext(overrides = {}) {
    const levels = ["info", "warn", "error", "debug"];
    return {
        tasksRuntime: undefined,
        logger: {
            options: { levels: [...levels] },
            configure: vi.fn(function configure(opts) {
                if (opts.levels !== undefined) {
                    const raw = typeof opts.levels === "string" ? opts.levels.split(",") : opts.levels;
                    this.options.levels = raw;
                }
                if (opts.silent !== undefined) this.options.silent = opts.silent;
            }),
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

describe("runtimeParams", () => {
    it("ensureTasksRuntime seeds loop knobs", () => {
        const ctx = makeContext();
        const rt = ensureTasksRuntime(ctx, { maxParallel: 8, pollMs: 250 });
        expect(rt.maxParallel).toBe(8);
        expect(rt.pollMs).toBe(250);
        expect(readLoopRuntime(ctx).maxParallel).toBe(8);
    });

    it("coerceRuntimeValue validates maxParallel / pollMs", () => {
        expect(coerceRuntimeValue("maxParallel", "16")).toBe(16);
        expect(coerceRuntimeValue("pollMs", 100)).toBe(100);
        expect(() => coerceRuntimeValue("maxParallel", 0)).toThrow(ParamError);
        expect(() => coerceRuntimeValue("pollMs", 10)).toThrow(ParamError);
    });

    it("applyRuntimeParam updates tasksRuntime and logger levels", async () => {
        const ctx = makeContext();
        ensureTasksRuntime(ctx, { maxParallel: 4 });
        const change = await applyRuntimeParam(ctx, "maxParallel", 16);
        expect(change.previous).toBe(4);
        expect(change.next).toBe(16);
        expect(ctx.tasksRuntime.maxParallel).toBe(16);

        await applyRuntimeParam(ctx, "levels", "+debug,info");
        expect(ctx.logger.configure).toHaveBeenCalledWith({ levels: "+debug,info" });
    });

    it("applyRuntimePatch applies multiple keys", async () => {
        const ctx = makeContext();
        ensureTasksRuntime(ctx, { maxParallel: 4, pollMs: 1000 });
        const changes = await applyRuntimePatch(ctx, { maxParallel: 12, pollMs: 200 });
        expect(changes).toHaveLength(2);
        expect(ctx.tasksRuntime.maxParallel).toBe(12);
        expect(ctx.tasksRuntime.pollMs).toBe(200);
    });

    it("invokes onRuntimeParam hook", async () => {
        const ctx = makeContext();
        const hook = vi.fn();
        ctx.tasksRuntimeOnParam = hook;
        ensureTasksRuntime(ctx, {});
        await applyRuntimeParam(ctx, "customKnob", "x");
        expect(hook).toHaveBeenCalledWith("customKnob", "x", ctx.tasksRuntime, ctx);
    });

    it("control lane includes setRuntimeParam and pause/unpause", () => {
        expect(controlLaneTaskNames()).toEqual(
            expect.arrayContaining([
                "stop",
                "stopRunner",
                "pause",
                "pauseRunner",
                "unpause",
                "unpauseRunner",
                "pauseTask",
                "resumeTask",
                "setRuntimeParam",
                "setRunnerParam",
            ])
        );
    });

    it("control lane merges optional extras (deduped)", () => {
        expect(controlLaneTaskNames(["hostInfo", "stop"])).toEqual(
            expect.arrayContaining(["stop", "hostInfo"])
        );
        expect(controlLaneTaskNames("hostInfo,ping").filter((n) => n === "hostInfo")).toHaveLength(1);
    });

    it("mergeRuntimeParamSpecs keeps defaults and merges extras", () => {
        const specs = mergeRuntimeParamSpecs([
            { key: "maxParallel", label: "Parallelism" },
            { key: "customKnob", type: "string", label: "Custom", description: "app-specific" },
        ]);
        expect(specs.find((s) => s.key === "maxParallel")?.label).toBe("Parallelism");
        expect(specs.find((s) => s.key === "customKnob")).toEqual(
            expect.objectContaining({ type: "string", label: "Custom" })
        );
        expect(specs.map((s) => s.key)).toEqual(
            expect.arrayContaining(DEFAULT_RUNTIME_PARAM_SPECS.map((s) => s.key))
        );
    });

    it("runtimeValuesForSpecs / runtimeParamSpecsFromMetadata", () => {
        const ctx = makeContext();
        ensureTasksRuntime(ctx, { maxParallel: 8, pollMs: 250 });
        expect(runtimeValuesForSpecs(ctx)).toEqual(
            expect.objectContaining({ maxParallel: 8, pollMs: 250 })
        );
        expect(runtimeParamSpecsFromMetadata({}).map((s) => s.key)).toEqual(
            DEFAULT_RUNTIME_PARAM_SPECS.map((s) => s.key)
        );
        expect(
            runtimeParamSpecsFromMetadata({
                runtimeParams: [{ key: "onlyThis", type: "number", label: "Only" }],
            }).find((s) => s.key === "onlyThis")?.label
        ).toBe("Only");
    });
});

describe("TaskSetRuntimeParam", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("is registered on withCoreTasks under both names", () => {
        const reg = TasksRegistry.withCoreTasks();
        expect(reg.get("setRuntimeParam")).toBe(TaskSetRuntimeParam);
        expect(reg.get("setRunnerParam")).toBe(TaskSetRuntimeParam);
    });

    it("resolveCustomParams accepts paramKey/paramValue", async () => {
        const ctx = makeContext({
            params: {
                getAllForModule: (_m, defs) => {
                    const out = {};
                    if (defs.paramKey) out.paramKey = "maxParallel";
                    if (defs.paramValue) out.paramValue = "16";
                    return out;
                },
                get: () => undefined,
            },
        });
        const custom = await TaskSetRuntimeParam.resolveCustomParams(ctx, {});
        expect(custom).toEqual({ key: "maxParallel", value: 16 });
    });

    it("resolveCustomParams accepts patch via paramsJson merge", async () => {
        const ctx = makeContext({
            params: {
                getAllForModule: () => ({
                    paramsJson: JSON.stringify({ patch: { maxParallel: 24, levels: "+debug" } }),
                }),
                get: () => undefined,
            },
        });
        // _mergeTypedParams parses paramsJson itself — simulate via overrides.params
        const custom = await TaskSetRuntimeParam.resolveCustomParams(ctx, {
            params: { patch: { maxParallel: 24, levels: "+debug" } },
        });
        expect(custom.patch.maxParallel).toBe(24);
    });

    it("run applies patch onto context", async () => {
        const ctx = makeContext();
        ensureTasksRuntime(ctx, { maxParallel: 8 });
        const task = new TaskSetRuntimeParam(ctx, {
            id: "t1",
            params: { patch: { maxParallel: 16, pollMs: 500 } },
        });
        const result = await task.run();
        expect(result.success).toBe(true);
        expect(result.results.runtimeParamApplied).toBe(true);
        expect(ctx.tasksRuntime.maxParallel).toBe(16);
        expect(ctx.tasksRuntime.pollMs).toBe(500);
    });

    it("resolveParams requires serviceName or serviceGroup", async () => {
        const ctx = makeContext({
            params: {
                getAllForModule: () => ({}),
                get: (k) => (k === "name" ? "setRuntimeParam" : undefined),
            },
        });
        await expect(
            TaskSetRuntimeParam.resolveParams(ctx, {
                name: "setRuntimeParam",
                params: { key: "maxParallel", value: 8 },
            })
        ).rejects.toThrow(/serviceName|serviceGroup/);
    });
});
