import type { Context } from "../init/types.js";
import { sleepMs, toJsonColumn } from "../utils/index.js";
import { enqueueTask, ensureTaskTables, queueToTableNames, updateTaskProgress } from "./taskUtils.js";
import { appendTaskIpcLog } from "./taskLogs.js";
import { timeMatcher } from "./time-matcher.js";
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

type DbLike = any;
const LOCKED_BY_ERROR_MESSAGE = "locked by error";

export { enqueueTask, ensureTaskTables, queueToTableNames, updateTaskProgress } from "./taskUtils.js";
export { appendTaskIpcLog } from "./taskLogs.js";
export { runNodeTaskScript } from "./taskScriptRunner.js";
export { TaskMaster } from "./TaskMaster.js";
export { TasksRegistry } from "./TasksRegistry.js";
export { TaskPing } from "./coreTasks/TaskPing.js";
export { TaskSampleProcess } from "./coreTasks/TaskSampleProcess.js";
export { TaskShellCommand } from "./coreTasks/TaskShellCommand.js";
export { TaskSystemInfo } from "./coreTasks/TaskSystemInfo.js";
export { TaskSumAB } from "./coreTasks/TaskSumAB.js";
export { TaskStopRunner } from "./coreTasks/TaskStopRunner.js";

export const defaultTasksRegistry = TasksRegistry.withCoreTasks();

function getDb(context: Context): DbLike {
    const db = (context as any).db;
    if (!db) {
        throw new Error("Tasks component requires context.db. Initialize DB first and attach to context.");
    }
    return db;
}

function normalizeRegistry(registry: TasksRegistry | TasksRegistryMap | undefined): TasksRegistry {
    if (!registry) return defaultTasksRegistry;
    if (registry instanceof TasksRegistry) return registry;
    return new TasksRegistry().addMany(registry);
}

function normalizeAllowedTasks(value: string[] | string | undefined): string[] | undefined {
    if (!value) return undefined;
    if (Array.isArray(value)) {
        const out = value.map((v) => String(v).trim()).filter(Boolean);
        return out.length ? out : undefined;
    }
    const out = String(value)
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
    return out.length ? out : undefined;
}

export async function enqueueStopTask(context: Context, target: string, queue = "tasks", allowanceMs = 5000): Promise<string> {
    return enqueueTask(context, {
        queue,
        target,
        task: "stopRunner",
        params: { allowanceMs },
        priority: 1000000,
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
    const taskName = row.task;
    const TaskClass = registry.get(taskName);
    const { paused_at: _pausedAt, ...rowForHistory } = row as any;

    if (!TaskClass) {
        const err = { message: `Unknown task "${taskName}"` };
        await db(historyTable).insert({
            ...rowForHistory,
            completed_at: new Date(),
            success: false,
            params: toJsonColumn(row.params),
            results: toJsonColumn(err),
        });
        if (row.schedule) {
            await db(tasksTable).where({ id: row.id }).update({
                started_at: null,
                completed_at: new Date(),
                success: false,
                results: toJsonColumn(err),
                past_due: null,
                paused_at: db.fn.now(),
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

    await db(historyTable).insert({
        ...rowForHistory,
        completed_at: new Date(),
        success,
        params: toJsonColumn(row.params),
        results: toJsonColumn(results),
    });
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
            message: `[tasks] task failed: ${row.task} id=${row.id}. Once problem is fixed, re-run: ${rerunCommand}`,
            details: results,
        });
    }

    if (row.schedule) {
        if (success) {
            await db(tasksTable).where({ id: row.id }).update({
                started_at: null,
                completed_at: new Date(),
                success,
                results: toJsonColumn(results),
                progress: null,
                past_due: null,
            });
        } else {
            await db(tasksTable).where({ id: row.id }).update({
                started_at: null,
                completed_at: new Date(),
                success,
                results: toJsonColumn(results),
                paused_at: db.fn.now(),
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

async function claimNextRunnableTask(
    context: Context,
    tasksTable: string,
    target: string,
    registry: TasksRegistry,
    scanLimit: number,
    taskNames?: string[]
): Promise<TaskRow | null> {
    const db = getDb(context);

    let query = db(tasksTable)
        .whereNull("started_at")
        .whereNull("paused_at")
        .where({ target })
        .orderByRaw("CASE WHEN past_due IS NULL THEN 1 ELSE 0 END ASC")
        .orderBy([{ column: "priority", order: "desc" }])
        // Fair rotation for recurring tasks:
        // 1) never-run rows first
        // 2) then least recently completed rows
        // 3) then stable created_at order
        .orderByRaw("CASE WHEN completed_at IS NULL THEN 0 ELSE 1 END ASC")
        .orderBy([{ column: "completed_at", order: "asc" }, { column: "created_at", order: "asc" }])
        .limit(scanLimit);
    if (taskNames && taskNames.length > 0) {
        query = query.whereIn("task", taskNames);
    }
    const candidates: TaskRow[] = await query;

    for (const row of candidates) {
        if (!row.past_due && row.schedule && !timeMatcher(row.schedule)) {
            continue;
        }

        const TaskClass = registry.get(row.task);
        if (TaskClass) {
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
        }

        const updated = await db(tasksTable)
            .where({ id: row.id })
            .whereNull("started_at")
            .whereNull("paused_at")
            .update({ started_at: db.fn.now() })
            .returning("*");

        const claimed = Array.isArray(updated) ? updated[0] : null;
        if (claimed) return claimed as TaskRow;
    }

    return null;
}

export async function runTasksLoop(context: Context, options: RunTasksLoopOptions): Promise<void> {
    const queue = options.queue ?? "tasks";
    const target = options.target;
    const pollMs = options.pollMs ?? 1000;
    const maxParallel = options.maxParallel ?? 1;
    const scanLimit = options.scanLimit ?? 100;
    const allowedTasks = normalizeAllowedTasks(options.allowedTasks);
    const registry = normalizeRegistry(options.registry as TasksRegistry | TasksRegistryMap | undefined);
    const { tasksTable, historyTable } = queueToTableNames(queue);

    if (!target) throw new Error("runTasksLoop: target is required");

    const runningPromises = new Set<Promise<void>>();
    const runningTaskInstances = new Map<string, TaskInstance>();
    let runningStopControlPromise: Promise<void> | null = null;
    let stopRequested = false;
    let stopAllowanceMs = 5000;
    (context as any).__tasksRunnerStop = false;

    while (!context.isStop() && !stopRequested && !(context as any).__tasksRunnerStop) {
        // Control lane: always allow stop task to be picked even when workers are busy.
        if (!runningStopControlPromise) {
            const claimedStopTask = await claimNextRunnableTask(
                context,
                tasksTable,
                target,
                registry,
                10,
                ["stopRunner", "stop"]
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
                            (context as any).__tasksRunnerStop = true;
                            await signalRunningTasksStop(context, runningTaskInstances, stopAllowanceMs);
                        }
                    })
                    .finally(() => {
                        runningStopControlPromise = null;
                    });
            }
        }

        while (runningPromises.size < maxParallel) {
            const claimed = await claimNextRunnableTask(
                context,
                tasksTable,
                target,
                registry,
                scanLimit,
                allowedTasks
            );
            if (!claimed) break;

            const p = executeClaimedTask(context, tasksTable, historyTable, claimed, registry, runningTaskInstances)
                .then(async (outcome) => {
                    if (outcome.stopRunnerRequested && !stopRequested) {
                        stopRequested = true;
                        stopAllowanceMs = outcome.stopAllowanceMs || 5000;
                        (context as any).__tasksRunnerStop = true;
                        await signalRunningTasksStop(context, runningTaskInstances, stopAllowanceMs);
                    }
                })
                .finally(() => {
                    runningPromises.delete(p);
                });
            runningPromises.add(p);
        }

        await sleepMs(pollMs);
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
}

export async function waitForTaskResult(
    context: Context,
    taskId: string,
    options: WaitForTaskResultOptions = {}
): Promise<TaskRow | null> {
    const db = getDb(context);
    const queue = options.queue ?? "tasks";
    const timeoutMs = options.timeoutMs ?? 60000;
    const pollMs = options.pollMs ?? 500;
    const { tasksTable, historyTable } = queueToTableNames(queue);
    const deadline = Date.now() + timeoutMs;

    while (Date.now() <= deadline) {
        const done = await db(historyTable).where({ id: taskId }).orderBy("created_at", "desc").first();
        if (done) return done as TaskRow;

        const pending = await db(tasksTable).where({ id: taskId }).first();
        if (!pending) {
            const maybeDone = await db(historyTable).where({ id: taskId }).orderBy("created_at", "desc").first();
            return (maybeDone as TaskRow) ?? null;
        }
        await sleepMs(pollMs);
    }
    return null;
}

export class TasksManager {
    private context: Context;
    private queue: string;
    private target: string;
    private recreateTaskTables: boolean;
    private pollMs: number;
    private maxParallel: number;
    private scanLimit: number;
    private allowedTasks: string[] | undefined;
    private registry: TasksRegistry;

    constructor(context: Context, options: TasksManagerInitOptions = {}) {
        this.context = context;
        this.queue = options.queue ?? "tasks";
        this.target = options.target ?? "localRunner";
        this.recreateTaskTables = options.recreateTaskTables ?? false;
        this.pollMs = options.pollMs ?? 1000;
        this.maxParallel = options.maxParallel ?? 1;
        this.scanLimit = options.scanLimit ?? 100;
        this.allowedTasks = normalizeAllowedTasks(options.allowedTasks);
        this.registry = normalizeRegistry(options.registry as TasksRegistry | TasksRegistryMap | undefined);
    }

    static init(context: Context, options: TasksManagerInitOptions = {}): TasksManager {
        const defs = {
            table: "string default tasks",
            target: "string default localRunner",
            recreateTaskTables: "boolean default false",
            pollMs: "number default 1000",
            maxParallel: "number default 1",
            scanLimit: "number default 100",
            allowedTasks: "string",
        };

        const discovered = (context as any).params.getAllForModule(defs);
        const resolved: TasksManagerInitOptions = {
            queue: discovered.table,
            target: discovered.target,
            recreateTaskTables: discovered.recreateTaskTables,
            pollMs: discovered.pollMs,
            maxParallel: discovered.maxParallel,
            scanLimit: discovered.scanLimit,
            allowedTasks: discovered.allowedTasks,
            ...options,
        };
        return new TasksManager(context, resolved);
    }

    async ensureTaskTables(options: { recreate?: boolean } = {}): Promise<void> {
        await ensureTaskTables(this.context, {
            queue: this.queue,
            recreate: options.recreate ?? this.recreateTaskTables,
        });
    }

    async runTasksLoop(options: Partial<RunTasksLoopOptions> = {}): Promise<void> {
        await runTasksLoop(this.context, {
            queue: options.queue ?? this.queue,
            target: options.target ?? this.target,
            pollMs: options.pollMs ?? this.pollMs,
            maxParallel: options.maxParallel ?? this.maxParallel,
            scanLimit: options.scanLimit ?? this.scanLimit,
            allowedTasks: options.allowedTasks ?? this.allowedTasks,
            registry: options.registry ?? this.registry,
        });
    }
}
