import os from "node:os";
import type { Context } from "../init/types.js";
import { sleepMs, toJsonColumn } from "../utils/index.js";
import {
    registerInServicesRegistry,
    touchServicesRegistry,
    unregisterServicesRegistry,
    type ServicesRegistryRegistration,
} from "./servicesRegistry.js";
import {
    enqueueTask,
    ensureTaskTables,
    queueToTableNames,
    taskHistoryInsertFromQueueRow,
    updateTaskProgress,
} from "./taskUtils.js";
import { appendTaskIpcLog } from "./taskLogs.js";
import { nextTimeMatch, timeMatcher } from "./time-matcher.js";
export {
    timeMatcher,
    nextTimeMatch,
    matchesParsedPattern,
    convertPattern,
    resolveAsterisks,
    resolveRanges,
    resolveSteps,
} from "./time-matcher.js";
export type { ParsedTimePattern } from "./time-matcher.js";
import { TasksRegistry } from "./TasksRegistry.js";
import type {
    RunTasksLoopOptions,
    TaskClass,
    TaskInstance,
    TasksManagerInitOptions,
    TaskRow,
    TasksRegistryMap,
    WaitForTaskResultOptions,
} from "./types.js";
import { normalizeAllowedTasks } from "./serviceTaskAllowlist.js";

type DbLike = any;
const LOCKED_BY_ERROR_MESSAGE = "locked by error";

export {
    enqueueTask,
    ensureTaskTables,
    queueToTableNames,
    taskHistoryInsertFromQueueRow,
    updateTaskProgress,
} from "./taskUtils.js";
export {
    listServicesRegistry,
    registerInServicesRegistry,
    touchServicesRegistry,
    unregisterServicesRegistry,
    updateServicesRegistryMetadata,
} from "./servicesRegistry.js";
export type { ServicesRegistryRegistration, ServicesRegistryRow, ServicesRegistryStartOptions } from "./servicesRegistry.js";
/** @deprecated Use registerInServicesRegistry */
export { registerInServicesRegistry as registerRunnerHeartbeat } from "./servicesRegistry.js";
/** @deprecated Use touchServicesRegistry */
export { touchServicesRegistry as touchRunnerHeartbeat } from "./servicesRegistry.js";
/** @deprecated Use unregisterServicesRegistry */
export { unregisterServicesRegistry as unregisterRunnerHeartbeat } from "./servicesRegistry.js";
/** @deprecated Use listServicesRegistry */
export { listServicesRegistry as listAliveRunnerHeartbeats } from "./servicesRegistry.js";
export type { ServicesRegistryRegistration as RunnerHeartbeatRegistration } from "./servicesRegistry.js";
export type { ServicesRegistryRow as RunnerHeartbeatRow } from "./servicesRegistry.js";
export type { ServicesRegistryStartOptions as RunnerHeartbeatStartOptions } from "./servicesRegistry.js";
export {
    appendTaskIpcLog,
    flushTaskIpcLogs,
    ipcFileLogsTableNameForSourceResource,
    readTaskIpcLogsSnapshot,
    resolveIpcFileLogsDir,
} from "./taskLogs.js";
export type { IpcFileLogTarget } from "./taskLogs.js";
export { runNodeTaskScript } from "./taskScriptRunner.js";
export type { TaskScriptRunResult, TaskScriptRunOptions } from "./taskScriptRunner.js";
export { AbstractTask } from "./AbstractTask.js";
export { TasksRegistry } from "./TasksRegistry.js";
export { TaskPing } from "./coreTasks/TaskPing.js";
export { TaskSampleProcess } from "./coreTasks/TaskSampleProcess.js";
export { TaskShellCommand } from "./coreTasks/TaskShellCommand.js";
export { TaskSystemInfo } from "./coreTasks/TaskSystemInfo.js";
export { TaskSumAB } from "./coreTasks/TaskSumAB.js";
export { TaskStopRunner } from "./coreTasks/TaskStopRunner.js";
export { TaskGetLogs } from "./coreTasks/TaskGetLogs.js";
export {
    normalizeAllowedTasks,
    mergeAllowedTasksWithServiceTasks,
    SERVICE_TASK_NAMES,
} from "./serviceTaskAllowlist.js";

export const defaultTasksRegistry = TasksRegistry.withCoreTasks();

function getDb(context: Context): DbLike {
    const db = context.db;
    if (!db) {
        throw new Error("Tasks component requires context.db. Initialize DB first and attach to context.");
    }
    return db as DbLike;
}

function normalizeRegistry(registry: TasksRegistry | TasksRegistryMap | undefined): TasksRegistry {
    if (!registry) return defaultTasksRegistry;
    if (registry instanceof TasksRegistry) return registry;
    return new TasksRegistry().addMany(registry);
}

export async function enqueueStopTask(context: Context, serviceGroup: string, queueName = "tasks", allowanceMs = 5000): Promise<string> {
    return enqueueTask(context, {
        queueName,
        name: "stopRunner",
        params: { allowanceMs },
        priority: 0,
        serviceGroup,
    });
}

async function signalRunningTasksStop(
    context: Context,
    runningTaskInstances: Map<string, TaskInstance>,
    allowanceMs: number
): Promise<void> {
    context.logger.warn?.(`[tasks] signaling ${runningTaskInstances.size} running task(s) to stop`);
    for (const [, taskInstance] of runningTaskInstances) {
        if (typeof taskInstance.requestStop === "function") {
            try {
                await taskInstance.requestStop(allowanceMs);
            } catch (error) {
                context.logger.warn?.("[tasks] task requestStop failed:", error);
            }
        }
    }
    context.emitter.emit("stop", allowanceMs);
}

async function executeClaimedTask(
    context: Context,
    tasksTable: string,
    historyTable: string,
    row: TaskRow,
    registry: TasksRegistry,
    runningTaskInstances: Map<string, TaskInstance>
): Promise<{ stopRunnerRequested: boolean; stopAllowanceMs: number }> {
    const db = getDb(context);
    const taskName = row.name;
    const TaskClass = registry.get(taskName);
    if (!TaskClass) {
        const err = { message: `Unknown task "${taskName}"` };
        await db(historyTable).insert(
            taskHistoryInsertFromQueueRow(row, {
                completed_at: new Date(),
                success: false,
                status: "failed",
                status_changed_at: db.fn.now(),
                params: toJsonColumn(row.params),
                results: toJsonColumn(err),
            })
        );
        if (row.schedule) {
            await db(tasksTable).where({ id: row.id }).update({
                started_at: null,
                completed_at: new Date(),
                success: false,
                results: toJsonColumn(err),
                past_due: null,
                status: "paused",
                status_changed_at: db.fn.now(),
                progress: LOCKED_BY_ERROR_MESSAGE,
            });
        } else {
            await db(tasksTable).where({ id: row.id }).delete();
        }
        return { stopRunnerRequested: false, stopAllowanceMs: 0 };
    }

    let success = false;
    let results: any = null;
    let taskInstance: TaskInstance | null = null;
    try {
        taskInstance = new TaskClass(context, row);
        runningTaskInstances.set(row.id, taskInstance);
        const runResult = await taskInstance.run((progress) => updateTaskProgress(context, tasksTable, row.id, progress));
        success = !!runResult?.success;
        results = runResult?.results ?? null;
    } catch (error: any) {
        success = false;
        results = {
            message: error?.message ?? String(error),
            name: error?.name ?? "Error",
            stack: error?.stack ?? null,
        };
    } finally {
        runningTaskInstances.delete(row.id);
    }

    await db(historyTable).insert(
        taskHistoryInsertFromQueueRow(row, {
            completed_at: new Date(),
            success,
            status: success ? "completed" : "failed",
            status_changed_at: db.fn.now(),
            params: toJsonColumn(row.params),
            results: toJsonColumn(results),
        })
    );
    if (!success) {
        const dbName = String((context as any)?.params?.get?.("dbName") || "local");
        const tableName = String((context as any)?.params?.get?.("table") || "tasks");
        const fallbackRecoverCommand = [
            "npx",
            "tsx",
            "examples/tasks/recover-task.ts",
            `--dbName='${dbName.replace(/'/g, `'\\''`)}'`,
            `--table='${tableName.replace(/'/g, `'\\''`)}'`,
            `--id='${String(row.id).replace(/'/g, `'\\''`)}'`,
        ].join(" ");
        const rerunCommand = results && typeof results === "object" && (results as any).rerunCommand
            ? (results as any).rerunCommand
            : fallbackRecoverCommand;
        appendTaskIpcLog(context, row, {
            level: "error",
            message: `[tasks] task failed: ${row.name} id=${row.id}. Once problem is fixed, re-run: ${rerunCommand}`,
            details: results,
        });
    }

    if (row.schedule) {
        if (success) {
            let nextRunAt: Date | null = null;
            try {
                nextRunAt = nextTimeMatch(row.schedule, new Date());
            } catch (e: any) {
                context.logger?.warn?.(`[tasks] nextTimeMatch after success for task ${row.id}: ${e?.message ?? String(e)}`);
            }
            await db(tasksTable).where({ id: row.id }).update({
                started_at: null,
                completed_at: new Date(),
                success,
                results: toJsonColumn(results),
                progress: null,
                past_due: null,
                status: "idle",
                status_changed_at: db.fn.now(),
                next_run_at: nextRunAt,
                // Claim overwrites these; clear so idle rows stay “any worker” (see claimNextRunnableTask).
                service_name: null,
                server_name: null,
                instance_number: null,
            });
        } else {
            await db(tasksTable).where({ id: row.id }).update({
                started_at: null,
                completed_at: new Date(),
                success,
                results: toJsonColumn(results),
                status: "paused",
                status_changed_at: db.fn.now(),
                progress: LOCKED_BY_ERROR_MESSAGE,
                past_due: null,
            });
        }
    } else {
        await db(tasksTable).where({ id: row.id }).delete();
    }

    const stopRunnerRequested = !!(results && typeof results === "object" && results.stopRunner === true);
    const stopAllowanceMs = stopRunnerRequested ? Number(results.allowanceMs ?? 5000) : 0;
    return { stopRunnerRequested, stopAllowanceMs };
}

type RunnerTaskIdentity = {
    service_name: string;
    server_name: string;
    instance_number: number;
};

/** Fisher–Yates shuffle so concurrent workers don't all try the same candidate row first. */
function shuffleTaskRowsInPlace(rows: TaskRow[]): void {
    for (let i = rows.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = rows[i]!;
        rows[i] = rows[j]!;
        rows[j] = t;
    }
}

async function claimNextRunnableTask(
    context: Context,
    tasksTable: string,
    serviceGroup: string,
    registry: TasksRegistry,
    scanLimit: number,
    taskNames?: string[],
    runnerIdentity?: RunnerTaskIdentity | null
): Promise<TaskRow | null> {
    const db = getDb(context);

    // Targeting: NULL on the task row means "any" for that field. Rows must match the runner's
    // service_group and identity (when provided) for each non-null task column.
    let query = db(tasksTable)
        .where({ status: "idle" })
        .where(function (this: any) {
            this.whereNull("service_group").orWhere({ service_group: serviceGroup });
        })
        .orderByRaw("CASE WHEN past_due IS NULL THEN 1 ELSE 0 END ASC")
        .orderBy([{ column: "priority", order: "asc" }])
        // Fair rotation for recurring tasks:
        // 1) never-run rows first
        // 2) then least recently completed rows
        // 3) then stable created_at order
        .orderByRaw("CASE WHEN completed_at IS NULL THEN 0 ELSE 1 END ASC")
        .orderBy([{ column: "completed_at", order: "asc" }, { column: "created_at", order: "asc" }])
        .limit(scanLimit);
    if (taskNames && taskNames.length > 0) {
        query = query.whereIn("name", taskNames);
    }
    if (runnerIdentity) {
        query = query
            .where(function (this: any) {
                this.whereNull("service_name").orWhere({ service_name: runnerIdentity.service_name });
            })
            .where(function (this: any) {
                this.whereNull("instance_number").orWhere({ instance_number: runnerIdentity.instance_number });
            })
            .where(function (this: any) {
                this.whereNull("server_name").orWhere({ server_name: runnerIdentity.server_name });
            });
    } else {
        // Without registry identity we cannot match a specific instance; only rows with no per-instance targeting.
        query = query
            .whereNull("service_name")
            .whereNull("instance_number")
            .whereNull("server_name");
    }
    const candidates: TaskRow[] = await query;
    shuffleTaskRowsInPlace(candidates);

    for (const row of candidates) {
        if (!row.past_due && row.schedule && !timeMatcher(row.schedule)) {
            continue;
        }

        const TaskClass = registry.get(row.name);
        if (!TaskClass) {
            // Not registered on this runner — skip without claiming so another worker can run it.
            continue;
        }

        const taskInstance = new TaskClass(context, row);
        const reason = taskInstance.cantRunReason ? await taskInstance.cantRunReason() : null;
        if (reason) {
            if (!row.past_due) {
                await db(tasksTable).where({ id: row.id }).update({
                    past_due: db.fn.now(),
                    progress: String(reason),
                });
            }
            continue;
        }

        const claimPatch: Record<string, unknown> = {
            started_at: db.fn.now(),
            status: "running",
            status_changed_at: db.fn.now(),
        };
        if (runnerIdentity) {
            claimPatch.service_name = runnerIdentity.service_name;
            claimPatch.server_name = runnerIdentity.server_name;
            claimPatch.instance_number = runnerIdentity.instance_number;
        }

        const updated = await db(tasksTable)
            .where({ id: row.id, status: "idle" })
            .update(claimPatch)
            .returning("*");

        const claimed = Array.isArray(updated) ? updated[0] : null;
        if (claimed) return claimed as TaskRow;
    }

    return null;
}

export async function runTasksLoop(context: Context, options: RunTasksLoopOptions): Promise<void> {
    const queueName = options.queueName ?? "tasks";
    const target = options.target;
    const pollMs = options.pollMs ?? 1000;
    const claimJitterMs = options.claimJitterMs ?? 0;
    const maxParallel = options.maxParallel ?? 32;
    const scanLimit = options.scanLimit ?? 100;
    const allowedTasks = normalizeAllowedTasks(options.allowedTasks);
    const registry = normalizeRegistry(options.registry as TasksRegistry | TasksRegistryMap | undefined);
    const { tasksTable, historyTable } = queueToTableNames(queueName);

    if (!target) throw new Error("runTasksLoop: target is required");

    context.tasksQueueName = queueName;

    const runningPromises = new Set<Promise<void>>();
    const runningTaskInstances = new Map<string, TaskInstance>();
    let runningStopControlPromise: Promise<void> | null = null;
    let stopRequested = false;
    let stopAllowanceMs = 5000;
    context.tasksRunnerStop = false;

    let registryReg: ServicesRegistryRegistration | null = null;
    let registryInterval: ReturnType<typeof setInterval> | null = null;
    let runnerIdentity: RunnerTaskIdentity | null = null;
    const hbGroup = options.runnerServiceGroup?.trim();
    if (hbGroup) {
        const hbIntervalMs = options.runnerHeartbeatIntervalMs ?? 10_000;
        const staleMs = options.runnerHeartbeatStaleMs ?? 45_000;
        const defaultMeta: Record<string, unknown> = {
            component: "tasks-runner",
            allowedTasks: allowedTasks?.length ? allowedTasks.join(",") : "all",
        };
        registryReg = await registerInServicesRegistry(context, {
            queueName,
            target,
            serviceGroup: hbGroup,
            serviceName: options.runnerServiceName,
            instanceNumber: options.runnerInstanceNumber,
            staleMs,
            groupMaxInstances: options.runnerGroupMaxInstances,
            enforceMaxInstances: options.runnerEnforceMaxInstances ?? true,
            metadata: options.runnerMetadata ?? defaultMeta,
        });
        runnerIdentity = {
            service_name: registryReg.serviceName,
            server_name: os.hostname(),
            instance_number: registryReg.instanceNumber,
        };
        registryInterval = setInterval(() => {
            void touchServicesRegistry(context, registryReg!).catch((err: any) => {
                context.logger.warn?.(`[services-registry] touch failed: ${err?.message ?? String(err)}`);
            });
        }, hbIntervalMs);
    }

    try {
    while (!context.isStop() && !stopRequested && context.tasksRunnerStop !== true) {
        // Control lane: always allow stop task to be picked even when workers are busy.
        if (!runningStopControlPromise) {
            const claimedStopTask = await claimNextRunnableTask(
                context,
                tasksTable,
                target,
                registry,
                10,
                ["stopRunner", "stop"],
                runnerIdentity
            );
            if (claimedStopTask) {
                runningStopControlPromise = executeClaimedTask(
                    context,
                    tasksTable,
                    historyTable,
                    claimedStopTask,
                    registry,
                    runningTaskInstances
                )
                    .then(async (outcome) => {
                        if (outcome.stopRunnerRequested && !stopRequested) {
                            stopRequested = true;
                            stopAllowanceMs = outcome.stopAllowanceMs || 5000;
                            context.tasksRunnerStop = true;
                            await signalRunningTasksStop(context, runningTaskInstances, stopAllowanceMs);
                        }
                    })
                    .finally(() => {
                        runningStopControlPromise = null;
                    });
            }
        }

        if (claimJitterMs > 0) {
            await sleepMs(Math.floor(Math.random() * (claimJitterMs + 1)));
        }

        while (runningPromises.size < maxParallel) {
            const claimed = await claimNextRunnableTask(
                context,
                tasksTable,
                target,
                registry,
                scanLimit,
                allowedTasks,
                runnerIdentity
            );
            if (!claimed) break;

            const p = executeClaimedTask(context, tasksTable, historyTable, claimed, registry, runningTaskInstances)
                .then(async (outcome) => {
                    if (outcome.stopRunnerRequested && !stopRequested) {
                        stopRequested = true;
                        stopAllowanceMs = outcome.stopAllowanceMs || 5000;
                        context.tasksRunnerStop = true;
                        await signalRunningTasksStop(context, runningTaskInstances, stopAllowanceMs);
                    }
                })
                .finally(() => {
                    runningPromises.delete(p);
                });
            runningPromises.add(p);
        }

        const wakePromises: Promise<unknown>[] = [...runningPromises];
        if (runningStopControlPromise) {
            wakePromises.push(runningStopControlPromise);
        }
        if (wakePromises.length === 0) {
            await sleepMs(pollMs);
        } else {
            const safe = wakePromises.map((p) => p.catch(() => undefined));
            await Promise.race([sleepMs(pollMs), Promise.race(safe)]);
        }
    }

    if (context.isStop() && !stopRequested) {
        await signalRunningTasksStop(context, runningTaskInstances, 5000);
    }

    if (runningPromises.size > 0) {
        if (stopRequested) {
            await Promise.race([
                Promise.allSettled(Array.from(runningPromises)),
                sleepMs(stopAllowanceMs).then(() => {
                    context.logger.warn?.(
                        `[tasks] stop allowance (${stopAllowanceMs}ms) reached; ${runningPromises.size} task(s) still running`
                    );
                }),
            ]);
        } else {
            await Promise.allSettled(Array.from(runningPromises));
        }
    }
    } finally {
        if (registryInterval) {
            clearInterval(registryInterval);
            registryInterval = null;
        }
        if (registryReg) {
            await unregisterServicesRegistry(context, registryReg).catch((err: any) => {
                context.logger.warn?.(`[services-registry] unregister failed: ${err?.message ?? String(err)}`);
            });
            registryReg = null;
            delete (context as any).servicesRegistry;
            delete (context as any).runnerHeartbeat;
        }
    }
}

export async function waitForTaskResult(
    context: Context,
    taskId: string,
    options: WaitForTaskResultOptions = {}
): Promise<TaskRow | null> {
    const db = getDb(context);
    const queueName = options.queueName ?? "tasks";
    const timeoutMs = options.timeoutMs ?? 60000;
    const pollMs = options.pollMs ?? 500;
    const { tasksTable, historyTable } = queueToTableNames(queueName);
    const deadline = Date.now() + timeoutMs;
    /** Only match history rows completed after we began waiting (avoids picking an older run with the same name/opid). */
    const waitStartedAt = new Date();
    let cachedNameOpid: { name: string; opid: string | null } | null = null;

    async function historySinceWait(name: string, opid: string | null) {
        let q = db(historyTable).where({ name }).where("completed_at", ">=", waitStartedAt);
        if (opid == null || opid === "") {
            q = q.whereNull("opid");
        } else {
            q = q.where({ opid });
        }
        return (await q.orderBy("completed_at", "desc").first()) as TaskRow | null;
    }

    while (Date.now() <= deadline) {
        const legacy = await db(historyTable).where({ id: taskId }).orderBy("created_at", "desc").first();
        if (legacy) {
            return legacy as TaskRow;
        }

        const pending = (await db(tasksTable).where({ id: taskId }).first()) as TaskRow | null;
        if (pending) {
            cachedNameOpid = { name: pending.name, opid: pending.opid };
            const done = await historySinceWait(pending.name, pending.opid);
            if (done) {
                return done;
            }
        } else if (cachedNameOpid) {
            const done = await historySinceWait(cachedNameOpid.name, cachedNameOpid.opid);
            if (done) {
                return done;
            }
            return null;
        } else {
            return null;
        }
        await sleepMs(pollMs);
    }
    return null;
}

export class TasksManager {
    private context: Context;
    private queueName: string;
    private target: string;
    private recreateTaskTables: boolean;
    private pollMs: number;
    private claimJitterMs: number;
    private maxParallel: number;
    private scanLimit: number;
    private allowedTasks: string[] | undefined;
    private registry: TasksRegistry;
    private runnerServiceGroup?: string;
    private runnerServiceName?: string;
    private runnerInstanceNumber?: number;
    private runnerHeartbeatIntervalMs?: number;
    private runnerHeartbeatStaleMs?: number;
    private runnerGroupMaxInstances?: number;
    private runnerEnforceMaxInstances?: boolean;
    private runnerMetadata?: Record<string, unknown> | null;

    constructor(context: Context, options: TasksManagerInitOptions = {}) {
        this.context = context;
        this.queueName = options.queueName ?? "tasks";
        this.target = options.target ?? "localRunner";
        this.recreateTaskTables = options.recreateTaskTables ?? false;
        this.pollMs = options.pollMs ?? 1000;
        this.claimJitterMs = options.claimJitterMs ?? 0;
        this.maxParallel = options.maxParallel ?? 1;
        this.scanLimit = options.scanLimit ?? 100;
        this.allowedTasks = normalizeAllowedTasks(options.allowedTasks);
        this.registry = normalizeRegistry(options.registry as TasksRegistry | TasksRegistryMap | undefined);
        this.runnerServiceGroup = options.runnerServiceGroup;
        this.runnerServiceName = options.runnerServiceName;
        this.runnerInstanceNumber = options.runnerInstanceNumber;
        this.runnerHeartbeatIntervalMs = options.runnerHeartbeatIntervalMs;
        this.runnerHeartbeatStaleMs = options.runnerHeartbeatStaleMs;
        this.runnerGroupMaxInstances = options.runnerGroupMaxInstances;
        this.runnerEnforceMaxInstances = options.runnerEnforceMaxInstances;
        this.runnerMetadata = options.runnerMetadata;
    }

    static init(context: Context, options: TasksManagerInitOptions = {}): TasksManager {
        const defs = {
            table: "string default tasks",
            target: "string default localRunner",
            recreateTaskTables: "boolean default false",
            pollMs: "number default 1000",
            claimJitterMs: "number default 0",
            maxParallel: "number default 1",
            scanLimit: "number default 100",
            allowedTasks: "string",
            runnerServiceGroup: "string",
            runnerServiceName: "string",
            runnerInstanceNumber: "number",
            runnerHeartbeatIntervalMs: "number default 10000",
            runnerHeartbeatStaleMs: "number default 45000",
            runnerGroupMaxInstances: "number",
            runnerEnforceMaxInstances: "boolean default true",
        };

        const discovered = (context as any).params.getAllForModule("tasks", defs);
        const resolved: TasksManagerInitOptions = {
            queueName: discovered.table,
            target: discovered.target,
            recreateTaskTables: discovered.recreateTaskTables,
            pollMs: discovered.pollMs,
            claimJitterMs: discovered.claimJitterMs,
            maxParallel: discovered.maxParallel,
            scanLimit: discovered.scanLimit,
            allowedTasks: discovered.allowedTasks,
            runnerServiceGroup: discovered.runnerServiceGroup,
            runnerServiceName: discovered.runnerServiceName,
            runnerInstanceNumber: discovered.runnerInstanceNumber,
            runnerHeartbeatIntervalMs: discovered.runnerHeartbeatIntervalMs,
            runnerHeartbeatStaleMs: discovered.runnerHeartbeatStaleMs,
            runnerGroupMaxInstances: discovered.runnerGroupMaxInstances,
            runnerEnforceMaxInstances: discovered.runnerEnforceMaxInstances,
            ...options,
        };
        return new TasksManager(context, resolved);
    }

    async ensureTaskTables(options: { recreate?: boolean } = {}): Promise<void> {
        await ensureTaskTables(this.context, {
            queueName: this.queueName,
            recreate: options.recreate ?? this.recreateTaskTables,
        });
    }

    async runTasksLoop(options: Partial<RunTasksLoopOptions> = {}): Promise<void> {
        await runTasksLoop(this.context, {
            queueName: options.queueName ?? this.queueName,
            target: options.target ?? this.target,
            pollMs: options.pollMs ?? this.pollMs,
            claimJitterMs: options.claimJitterMs ?? this.claimJitterMs,
            maxParallel: options.maxParallel ?? this.maxParallel,
            scanLimit: options.scanLimit ?? this.scanLimit,
            allowedTasks: options.allowedTasks ?? this.allowedTasks,
            registry: options.registry ?? this.registry,
            runnerServiceGroup: options.runnerServiceGroup ?? this.runnerServiceGroup,
            runnerServiceName: options.runnerServiceName ?? this.runnerServiceName,
            runnerInstanceNumber: options.runnerInstanceNumber ?? this.runnerInstanceNumber,
            runnerHeartbeatIntervalMs: options.runnerHeartbeatIntervalMs ?? this.runnerHeartbeatIntervalMs,
            runnerHeartbeatStaleMs: options.runnerHeartbeatStaleMs ?? this.runnerHeartbeatStaleMs,
            runnerGroupMaxInstances: options.runnerGroupMaxInstances ?? this.runnerGroupMaxInstances,
            runnerEnforceMaxInstances: options.runnerEnforceMaxInstances ?? this.runnerEnforceMaxInstances,
            runnerMetadata: options.runnerMetadata ?? this.runnerMetadata,
        });
    }
}
