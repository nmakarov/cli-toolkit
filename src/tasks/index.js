import os from "node:os";
import { sleepMs, toJsonColumn } from "../utils/index.js";
import {
    registerInServicesRegistry,
    touchServicesRegistry,
    unregisterServicesRegistry,
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
import { TasksRegistry } from "./TasksRegistry.js";
import { normalizeAllowedTasks } from "./serviceTaskAllowlist.js";

/** Sentinel value stored in the `progress` column when a task is paused due to error. */
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
/** @deprecated Use registerInServicesRegistry */
export { registerInServicesRegistry as registerRunnerHeartbeat } from "./servicesRegistry.js";
/** @deprecated Use touchServicesRegistry */
export { touchServicesRegistry as touchRunnerHeartbeat } from "./servicesRegistry.js";
/** @deprecated Use unregisterServicesRegistry */
export { unregisterServicesRegistry as unregisterRunnerHeartbeat } from "./servicesRegistry.js";
/** @deprecated Use listServicesRegistry */
export { listServicesRegistry as listAliveRunnerHeartbeats } from "./servicesRegistry.js";
export {
    appendTaskIpcLog,
    flushTaskIpcLogs,
    ipcFileLogsTableNameForSourceResource,
    readTaskIpcLogsSnapshot,
    resolveIpcFileLogsDir,
} from "./taskLogs.js";
export { runNodeTaskScript } from "./taskScriptRunner.js";
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

/** Shared default registry preloaded with every core task (including legacy aliases). */
export const defaultTasksRegistry = TasksRegistry.withCoreTasks();

/**
 * Fail-fast accessor for `context.db` with a tasks-specific error message.
 *
 * @param {object} context
 * @returns {Function}
 */
function getDb(context) {
    const db = context.db;
    if (!db) {
        throw new Error("Tasks component requires context.db. Initialize DB first and attach to context.");
    }
    return db;
}

/**
 * Coerce whatever the caller passed as `registry` into a `TasksRegistry` instance:
 *
 *   - `undefined` / missing → {@link defaultTasksRegistry} (every core task)
 *   - already a `TasksRegistry` → returned as-is
 *   - plain `{ name: Class }` map → wrapped in a fresh registry
 *
 * @param {TasksRegistry | Record<string, Function> | undefined} registry
 * @returns {TasksRegistry}
 */
function normalizeRegistry(registry) {
    if (!registry) return defaultTasksRegistry;
    if (registry instanceof TasksRegistry) return registry;
    return new TasksRegistry().addMany(registry);
}

/**
 * Convenience for enqueuing a targeted `stopRunner` task so a specific service
 * group exits cleanly on its next tick. Intended for operator tooling — the
 * runner itself also accepts in-process stop signals via `context.isStop()`.
 *
 * @param {object} context
 * @param {string} serviceGroup
 * @param {string} [queueName]
 * @param {number} [allowanceMs]
 * @returns {Promise<string>} UUID of the enqueued stop task.
 */
export async function enqueueStopTask(context, serviceGroup, queueName = "tasks", allowanceMs = 5000) {
    return enqueueTask(context, {
        queueName,
        name: "stopRunner",
        params: { allowanceMs },
        priority: 0,
        serviceGroup,
    });
}

/**
 * Broadcast a cooperative stop signal to every currently-running task instance.
 * Tasks decide per-call how much of `allowanceMs` to honor; we also emit on
 * `context.emitter` so other subscribers (e.g. fetchers) can wind down.
 *
 * @param {object} context
 * @param {Map<string, { requestStop?: Function }>} runningTaskInstances
 * @param {number} allowanceMs
 * @returns {Promise<void>}
 */
async function signalRunningTasksStop(context, runningTaskInstances, allowanceMs) {
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

/**
 * Run a single claimed task row end-to-end:
 *
 *   1. Resolve its class from the registry (unknown name → record failure + remove/pause).
 *   2. Construct an instance, stash it in `runningTaskInstances` so stop signals can reach it.
 *   3. `await instance.run(reportProgress)`; capture thrown errors into a structured `results` payload.
 *   4. Append a row to the history table, update/delete/pause the queue row depending on schedule/success.
 *   5. Return a summary telling the loop whether a `stopRunner` was requested.
 *
 * @param {object} context
 * @param {string} tasksTable
 * @param {string} historyTable
 * @param {object} row              The claimed queue row.
 * @param {TasksRegistry} registry
 * @param {Map<string, object>} runningTaskInstances
 * @returns {Promise<{ stopRunnerRequested: boolean, stopAllowanceMs: number }>}
 */
async function executeClaimedTask(context, tasksTable, historyTable, row, registry, runningTaskInstances) {
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
    let results = null;
    let taskInstance = null;
    try {
        taskInstance = new TaskClass(context, row);
        runningTaskInstances.set(row.id, taskInstance);
        const runResult = await taskInstance.run((progress) => updateTaskProgress(context, tasksTable, row.id, progress));
        success = !!runResult?.success;
        results = runResult?.results ?? null;
    } catch (error) {
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
        const dbName = String(context?.params?.get?.("dbName") || "local");
        const tableName = String(context?.params?.get?.("table") || "tasks");
        const fallbackRecoverCommand = [
            "node",
            "examples/tasks/recover-task.js",
            `--dbName='${dbName.replace(/'/g, `'\\''`)}'`,
            `--table='${tableName.replace(/'/g, `'\\''`)}'`,
            `--id='${String(row.id).replace(/'/g, `'\\''`)}'`,
        ].join(" ");
        const rerunCommand = results && typeof results === "object" && results.rerunCommand
            ? results.rerunCommand
            : fallbackRecoverCommand;
        appendTaskIpcLog(context, row, {
            level: "error",
            message: `[tasks] task failed: ${row.name} id=${row.id}. Once problem is fixed, re-run: ${rerunCommand}`,
            details: results,
        });
    }

    if (row.schedule) {
        if (success) {
            let nextRunAt = null;
            try {
                nextRunAt = nextTimeMatch(row.schedule, new Date());
            } catch (e) {
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

/** Fisher–Yates shuffle so concurrent workers don't all try the same candidate row first. */
function shuffleTaskRowsInPlace(rows) {
    for (let i = rows.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = rows[i];
        rows[i] = rows[j];
        rows[j] = t;
    }
}

/**
 * Atomically claim one runnable task row matching the caller's service group /
 * identity / allowlist, and return the (now-`running`) row — or `null` when none
 * are ready.
 *
 * Targeting rules for task columns (`service_group`, `service_name`, `server_name`,
 * `instance_number`): NULL on the task row means "any" for that field; a value
 * means "this runner must match exactly". This lets operators enqueue a task for
 * a specific host/instance while letting other rows fan out to whoever is free.
 *
 * @param {object} context
 * @param {string} tasksTable
 * @param {string} serviceGroup
 * @param {TasksRegistry} registry
 * @param {number} scanLimit How many candidate rows to pull before attempting claim.
 * @param {string[]|undefined} taskNames When set, only claim rows with `name IN taskNames`.
 * @param {{ service_name: string, server_name: string, instance_number: number }|null} runnerIdentity
 * @returns {Promise<object|null>} The claimed row, or `null` when nothing is ready.
 */
async function claimNextRunnableTask(
    context,
    tasksTable,
    serviceGroup,
    registry,
    scanLimit,
    taskNames,
    runnerIdentity
) {
    const db = getDb(context);

    // Targeting: NULL on the task row means "any" for that field. Rows must match the runner's
    // service_group and identity (when provided) for each non-null task column.
    let query = db(tasksTable)
        .where({ status: "idle" })
        .where(function () {
            this.whereNull("service_group").orWhere({ service_group: serviceGroup });
        })
        // Honor next_run_at as a "not before" gate. NULL = no delay (claim now).
        // This makes delayed one-off retries (next_run_at set, no schedule) wait
        // their turn; scheduled rows already set next_run_at to their next fire
        // time on enqueue/completion, so this stays consistent with timeMatcher.
        .where(function () {
            this.whereNull("next_run_at").orWhere("next_run_at", "<=", db.fn.now());
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
            .where(function () {
                this.whereNull("service_name").orWhere({ service_name: runnerIdentity.service_name });
            })
            .where(function () {
                this.whereNull("instance_number").orWhere({ instance_number: runnerIdentity.instance_number });
            })
            .where(function () {
                this.whereNull("server_name").orWhere({ server_name: runnerIdentity.server_name });
            });
    } else {
        // Without registry identity we cannot match a specific instance; only rows with no per-instance targeting.
        query = query
            .whereNull("service_name")
            .whereNull("instance_number")
            .whereNull("server_name");
    }
    const candidates = await query;
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

        const claimPatch = {
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
        if (claimed) return claimed;
    }

    return null;
}

/**
 * Main runner loop. Registers in the services registry (optional), then polls
 * the queue, claiming up to `maxParallel` tasks at a time plus one extra
 * "control lane" for `stop`/`stopRunner` so a graceful stop can always be picked
 * even when workers are saturated.
 *
 * Exits when any of the following become true:
 *   - `context.isStop()` flips to `true` (external shutdown signal).
 *   - A `stopRunner` task completes successfully.
 *   - `context.tasksRunnerStop === true` (manual flag, mostly for tests).
 *
 * @param {object} context
 * @param {{
 *   queueName?: string,
 *   target: string,
 *   pollMs?: number,
 *   claimJitterMs?: number,
 *   maxParallel?: number,
 *   scanLimit?: number,
 *   allowedTasks?: string | string[],
 *   registry?: TasksRegistry | Record<string, Function>,
 *   runnerServiceGroup?: string,
 *   runnerServiceName?: string,
 *   runnerInstanceNumber?: number,
 *   runnerHeartbeatIntervalMs?: number,
 *   runnerHeartbeatStaleMs?: number,
 *   runnerGroupMaxInstances?: number,
 *   runnerEnforceMaxInstances?: boolean,
 *   runnerMetadata?: Record<string, unknown>,
 * }} options
 * @returns {Promise<void>}
 */
export async function runTasksLoop(context, options) {
    const queueName = options.queueName ?? "tasks";
    const target = options.target;
    const pollMs = options.pollMs ?? 1000;
    const claimJitterMs = options.claimJitterMs ?? 0;
    const maxParallel = options.maxParallel ?? 32;
    const scanLimit = options.scanLimit ?? 100;
    const allowedTasks = normalizeAllowedTasks(options.allowedTasks);
    const registry = normalizeRegistry(options.registry);
    const { tasksTable, historyTable } = queueToTableNames(queueName);

    if (!target) throw new Error("runTasksLoop: target is required");

    context.tasksQueueName = queueName;

    const runningPromises = new Set();
    const runningTaskInstances = new Map();
    let runningStopControlPromise = null;
    let stopRequested = false;
    let stopAllowanceMs = 5000;
    context.tasksRunnerStop = false;

    let registryReg = null;
    let registryInterval = null;
    let runnerIdentity = null;
    const hbGroup = options.runnerServiceGroup?.trim();
    if (hbGroup) {
        const hbIntervalMs = options.runnerHeartbeatIntervalMs ?? 10_000;
        const staleMs = options.runnerHeartbeatStaleMs ?? 45_000;
        const defaultMeta = {
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
            void touchServicesRegistry(context, registryReg).catch((err) => {
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

            const wakePromises = [...runningPromises];
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
            await unregisterServicesRegistry(context, registryReg).catch((err) => {
                context.logger.warn?.(`[services-registry] unregister failed: ${err?.message ?? String(err)}`);
            });
            registryReg = null;
            delete context.servicesRegistry;
            delete context.runnerHeartbeat;
        }
    }
}

/**
 * Poll for the outcome of a task by id. Returns the matching `_history` row when
 * the task completes, or `null` when the wait times out / the queue row vanishes
 * without a history entry (unusual; usually a manual delete).
 *
 * Resolves either of:
 *   - Legacy path: a history row whose `id` matches the original task id.
 *   - Modern path: a history row with the same `name`+`opid` whose
 *     `completed_at` is ≥ when we started waiting (so we don't pick up an older run).
 *
 * @param {object} context
 * @param {string} taskId
 * @param {{ queueName?: string, timeoutMs?: number, pollMs?: number }} [options]
 * @returns {Promise<object|null>}
 */
export async function waitForTaskResult(context, taskId, options = {}) {
    const db = getDb(context);
    const queueName = options.queueName ?? "tasks";
    const timeoutMs = options.timeoutMs ?? 60000;
    const pollMs = options.pollMs ?? 500;
    const { tasksTable, historyTable } = queueToTableNames(queueName);
    const deadline = Date.now() + timeoutMs;
    /** Only match history rows completed after we began waiting (avoids picking an older run with the same name/opid). */
    const waitStartedAt = new Date();
    let cachedNameOpid = null;

    /**
     * Look for a matching history entry completed since we started waiting.
     *
     * @param {string} name
     * @param {string|null|undefined} opid
     * @returns {Promise<object|undefined>}
     */
    async function historySinceWait(name, opid) {
        let q = db(historyTable).where({ name }).where("completed_at", ">=", waitStartedAt);
        if (opid == null || opid === "") {
            q = q.whereNull("opid");
        } else {
            q = q.where({ opid });
        }
        return await q.orderBy("completed_at", "desc").first();
    }

    while (Date.now() <= deadline) {
        const legacy = await db(historyTable).where({ id: taskId }).orderBy("created_at", "desc").first();
        if (legacy) {
            return legacy;
        }

        const pending = await db(tasksTable).where({ id: taskId }).first();
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

/**
 * Higher-level wrapper over {@link runTasksLoop}: captures defaults / params-driven
 * config at construction, then exposes them as methods (`ensureTaskTables`,
 * `runTasksLoop`) so callers don't have to plumb the same options through twice.
 *
 * Prefer `TasksManager.init(context)` over the bare constructor — `init` pulls
 * sensible defaults from `context.params` using the `tasks` module namespace.
 */
export class TasksManager {
    /**
     * @param {object} context
     * @param {{
     *   queueName?: string,
     *   target?: string,
     *   recreateTaskTables?: boolean,
     *   pollMs?: number,
     *   claimJitterMs?: number,
     *   maxParallel?: number,
     *   scanLimit?: number,
     *   allowedTasks?: string | string[],
     *   registry?: TasksRegistry | Record<string, Function>,
     *   runnerServiceGroup?: string,
     *   runnerServiceName?: string,
     *   runnerInstanceNumber?: number,
     *   runnerHeartbeatIntervalMs?: number,
     *   runnerHeartbeatStaleMs?: number,
     *   runnerGroupMaxInstances?: number,
     *   runnerEnforceMaxInstances?: boolean,
     *   runnerMetadata?: Record<string, unknown>,
     * }} [options]
     */
    constructor(context, options = {}) {
        this.context = context;
        this.queueName = options.queueName ?? "tasks";
        this.target = options.target ?? "localRunner";
        this.recreateTaskTables = options.recreateTaskTables ?? false;
        this.pollMs = options.pollMs ?? 1000;
        this.claimJitterMs = options.claimJitterMs ?? 0;
        this.maxParallel = options.maxParallel ?? 1;
        this.scanLimit = options.scanLimit ?? 100;
        this.allowedTasks = normalizeAllowedTasks(options.allowedTasks);
        this.registry = normalizeRegistry(options.registry);
        this.runnerServiceGroup = options.runnerServiceGroup;
        this.runnerServiceName = options.runnerServiceName;
        this.runnerInstanceNumber = options.runnerInstanceNumber;
        this.runnerHeartbeatIntervalMs = options.runnerHeartbeatIntervalMs;
        this.runnerHeartbeatStaleMs = options.runnerHeartbeatStaleMs;
        this.runnerGroupMaxInstances = options.runnerGroupMaxInstances;
        this.runnerEnforceMaxInstances = options.runnerEnforceMaxInstances;
        this.runnerMetadata = options.runnerMetadata;
    }

    /**
     * Preferred factory: reads defaults from `context.params` (module namespace
     * `"tasks"`), then overlays explicit `options`. Keeps CLI flags, env vars,
     * and inline options in one consistent resolver.
     *
     * @param {object} context
     * @param {ConstructorParameters<typeof TasksManager>[1]} [options]
     * @returns {TasksManager}
     */
    static init(context, options = {}) {
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

        const discovered = context.params.getAllForModule("tasks", defs);
        const resolved = {
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

    /**
     * Idempotently ensure the three backing tables exist for this queue.
     *
     * @param {{ recreate?: boolean }} [options]
     * @returns {Promise<void>}
     */
    async ensureTaskTables(options = {}) {
        await ensureTaskTables(this.context, {
            queueName: this.queueName,
            recreate: options.recreate ?? this.recreateTaskTables,
        });
    }

    /**
     * Start the runner loop using this manager's resolved config. Per-call
     * options override the stored defaults, but `runnerMetadata` still falls
     * through when omitted.
     *
     * @param {Partial<ConstructorParameters<typeof TasksManager>[1]>} [options]
     * @returns {Promise<void>}
     */
    async runTasksLoop(options = {}) {
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
