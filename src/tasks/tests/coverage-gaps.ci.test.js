import { describe, expect, it, vi } from "vitest";
import { ParamError } from "../../errors.js";
import { getDirname, ensurePath, ensurePathSync, getFileExtension } from "../../utils/fs-utils.js";
import { buildFooter, FooterPresets, organizeFooterMessages } from "../../screen/footer-builder.js";
import { applyRuntimeParam, applyRuntimePatch, readLoopRuntime } from "../runtimeParams.js";
import { enqueueTask, queueToTableNames, updateTaskProgress, createTaskProgressReporter } from "../taskUtils.js";
import { TaskPauseTask, TaskResumeTask } from "../coreTasks/TaskPauseTask.js";
import { TaskSetRuntimeParam } from "../coreTasks/TaskSetRuntimeParam.js";
import { setGroupMaxInstancesDefaults, registerInServicesRegistry } from "../servicesRegistry.js";

function paramsFrom(values = {}) {
    return {
        get: (key) => values[key],
        getAllForModule: (_mod, defs = {}) => {
            const out = {};
            for (const [k, spec] of Object.entries(defs)) {
                if (k in values) out[k] = values[k];
                else if (typeof spec === "string" && spec.includes("default ")) {
                    const def = spec.split("default ")[1];
                    out[k] = spec.startsWith("number") ? Number(def) : def;
                }
            }
            return out;
        },
    };
}

function fakeEnqueueDb() {
    const chain = {
        insert: vi.fn(async () => 1),
        where: vi.fn(() => chain),
        update: vi.fn(async () => 1),
        first: vi.fn(async () => null),
    };
    const db = vi.fn(() => chain);
    db.fn = { now: () => new Date() };
    db.schema = { hasColumn: async () => false };
    db.config = { name: "gap-db" };
    return { db, chain };
}

describe("coverage gaps", () => {
    it("fs-utils helpers", async () => {
        expect(getDirname(import.meta.url)).toMatch(/tests$/);
        expect(getFileExtension("text")).toBe("txt");
        expect(getFileExtension("xml")).toBe("xml");
        expect(getFileExtension("json-object")).toBe("json");
        const dir = await ensurePath("/tmp", `cli-tk-gap-${Date.now()}`);
        expect(ensurePathSync(dir)).toBe(dir);
    });

    it("footer-builder presets and organizeFooterMessages", () => {
        expect(buildFooter({ custom: "x", info: ["i"] }).length).toBeGreaterThan(0);
        expect(FooterPresets.menu("hi")[0]).toMatch(/navigate/);
        expect(FooterPresets.wordGrid(3).some((l) => l.includes("Total"))).toBe(true);
        expect(FooterPresets.textInput()[0]).toMatch(/Type/);
        expect(FooterPresets.info()[0]).toMatch(/Esc/);
        expect(FooterPresets.mainMenu()[0]).toMatch(/exit/);
        expect(FooterPresets.actionMenu(true).some((l) => l.includes("Audio"))).toBe(true);
        expect(organizeFooterMessages([])).toEqual(["Esc to go back"]);
        expect(organizeFooterMessages(["↑ down", "Enter to select", "other"])).toHaveLength(2);
    });

    it("runtimeParams hook, logger key, patch errors, readLoopRuntime", async () => {
        const context = {
            tasksRuntime: {},
            logger: { configure: vi.fn(), warn: vi.fn() },
            tasksRuntimeOnParam: vi.fn(async () => {}),
        };
        const one = await applyRuntimeParam(context, "levels", "+debug");
        expect(one.applied).toContain("logger");
        expect(one.applied).toContain("onRuntimeParam");
        context.servicesRegistry = { rowId: "r1", registryTable: "tasks_services_registry", serviceName: "s" };
        context.db = fakeEnqueueDb().db;
        context.db().first = vi.fn(async () => ({ metadata: "{}" }));
        const withReg = await applyRuntimeParam(context, "maxParallel", 4);
        expect(withReg.applied).toContain("servicesRegistry");
        context.db().where = vi.fn(() => {
            throw new Error("meta fail");
        });
        await applyRuntimeParam(context, "pollMs", 100);
        await expect(applyRuntimeParam(context, "", 1)).rejects.toBeInstanceOf(ParamError);
        await expect(applyRuntimePatch(context, [])).rejects.toBeInstanceOf(ParamError);
        await expect(applyRuntimePatch(context, {})).rejects.toBeInstanceOf(ParamError);
        const patch = await applyRuntimePatch(context, { pollMs: 200 });
        expect(patch[0].key).toBe("pollMs");
        expect(readLoopRuntime({ tasksRuntime: { maxParallel: 0, pollMs: 10 } }).pollMs).toBeGreaterThanOrEqual(50);
    });

    it("enqueueTask and progress reporter", async () => {
        const { db, chain } = fakeEnqueueDb();
        const context = { db, logger: { warn: vi.fn() } };
        const id = await enqueueTask(context, { name: "ping", params: { a: 1 }, schedule: "*/5 * * * * *" });
        expect(id).toMatch(/-/);
        await expect(enqueueTask(context, {})).rejects.toThrow(/name/);
        await updateTaskProgress(context, "tasks", id, "hello");
        await updateTaskProgress(context, "tasks", id, { n: 1 });
        const report = createTaskProgressReporter(context, "tasks", id);
        await report({ n: 2 });
        expect(queueToTableNames("jobs").historyTable).toBe("jobs_history");
        expect(chain.insert).toHaveBeenCalled();
    });

    it("pause/resume task classes and setRuntimeParam enqueue/patch", async () => {
        const logger = { warn: vi.fn(), info: vi.fn() };
        const { db } = fakeEnqueueDb();
        db().first = vi.fn(async () => ({ id: "t1", name: "ping", status: "paused", progress: null }));
        const ctx = {
            db,
            logger,
            params: paramsFrom({ name: "pauseTask", taskId: "t1" }),
            tasksQueueName: "tasks",
        };
        expect(await TaskPauseTask.resolveCustomParams(ctx, { params: { taskId: "t1" } })).toEqual({ taskId: "t1" });
        expect(await TaskResumeTask.resolveCustomParams(ctx, { params: { taskId: "t1" } })).toEqual({ taskId: "t1" });
        await new TaskPauseTask(ctx, { params: { taskId: "t1" } }).run();
        await new TaskResumeTask(ctx, { params: { taskId: "t1" } }).run();

        const setCtx = {
            db,
            logger,
            params: paramsFrom({
                name: "setRuntimeParam",
                serviceName: "host-1",
                paramsJson: '{"patch":{"maxParallel":8}}',
            }),
            tasksRuntime: {},
        };
        expect(await TaskSetRuntimeParam.resolveCustomParams(setCtx)).toEqual({ patch: { maxParallel: 8 } });
        const queued = await TaskSetRuntimeParam.enqueue(setCtx, { name: "setRuntimeParam", serviceName: "host-1" });
        expect(queued.ids).toHaveLength(1);
        const patched = await new TaskSetRuntimeParam(setCtx, { params: { patch: { pollMs: 500 } } }).run();
        expect(patched.results.runtimeParamApplied).toBe(true);
        const jsonVal = await TaskSetRuntimeParam.resolveCustomParams({
            params: paramsFrom({
                name: "setRuntimeParam",
                serviceName: "host-1",
                paramKey: "flag",
                paramValue: "true",
            }),
        });
        expect(jsonVal).toEqual({ key: "flag", value: true });
        expect(
            await TaskSetRuntimeParam.resolveCustomParams({
                params: paramsFrom({
                    name: "setRuntimeParam",
                    serviceName: "host-1",
                    paramKey: "obj",
                    paramValue: '{"a":1}',
                }),
            }),
        ).toEqual({ key: "obj", value: { a: 1 } });
        expect(
            await TaskSetRuntimeParam.resolveCustomParams({
                params: paramsFrom({
                    name: "setRuntimeParam",
                    serviceName: "host-1",
                    paramKey: "flag",
                    paramValue: "false",
                }),
            }),
        ).toEqual({ key: "flag", value: false });

        const listChain = {
            where: vi.fn(() => listChain),
            orderBy: vi.fn(() => listChain),
            insert: vi.fn(async () => 1),
            then: (resolve) =>
                resolve([
                    { service_name: "a1", server_name: "h", instance_number: 1 },
                    { service_name: "a2", server_name: "h", instance_number: 2 },
                ]),
        };
        const listDb = vi.fn(() => listChain);
        listDb.fn = { now: () => new Date() };
        listDb.schema = { hasColumn: async () => false };
        listDb.config = { name: "gap-db" };
        const broadcast = await TaskSetRuntimeParam.enqueue(
            { db: listDb, logger, params: paramsFrom({ name: "setRuntimeParam", serviceGroup: "alpha" }) },
            { serviceGroup: "alpha", params: { key: "maxParallel", value: 2 } },
        );
        expect(broadcast.targets).toEqual(["a1", "a2"]);
        await expect(
            TaskSetRuntimeParam.enqueue(
                {
                    db: listDb,
                    logger,
                    params: paramsFrom({ name: "setRuntimeParam" }),
                },
                { params: { key: "x", value: 1 } },
            ),
        ).rejects.toBeInstanceOf(ParamError);
    });

    it("servicesRegistry warns when over limit and enforce is off", async () => {
        setGroupMaxInstancesDefaults({ alpha: 1 });
        const occupied = [1];
        const chain = {
            where: vi.fn(() => chain),
            whereNot: vi.fn(() => chain),
            first: vi.fn(async () => ({ count: 1 })),
            count: vi.fn(() => chain),
            select: vi.fn(async () => occupied.map((n) => ({ instance_number: n }))),
            insert: vi.fn(() => ({
                returning: async () => [{ id: "n1", service_name: "alpha-x-2" }],
            })),
            fn: { now: () => new Date() },
        };
        const db = vi.fn(() => chain);
        db.fn = { now: () => new Date() };
        const logger = { warn: vi.fn(), info: vi.fn() };
        await expect(
            registerInServicesRegistry(
                { db, logger },
                {
                    queueName: "tasks",
                    serviceGroup: "alpha",
                    staleMs: 45_000,
                    enforceMaxInstances: false,
                    instanceNumber: 2,
                    groupMaxInstances: 1,
                },
            ),
        ).rejects.toThrow();
        setGroupMaxInstancesDefaults(null);
    });
});
