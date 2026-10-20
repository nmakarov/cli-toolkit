/**
 * Pause / resume a single queue task (not the runner).
 *
 * pauseTask:
 *   - idle → status=paused (persists across runner restart/redeploy)
 *   - running → stamp progress.pauseRequested + call requestPause() on the
 *     in-process instance when this runner owns it; the task cooperatively
 *     finishes its current unit and returns `{ taskPaused: true }`
 *   - already paused → no-op success
 *
 * resumeTask:
 *   - paused → status=idle (clears pauseRequested)
 *   - stamps `past_due` + `next_run_at` so a scheduled row is claimed on the
 *     next poll (does not wait for the next cron slot)
 *   - drops pauseTask rows still queued for this id, including one left
 *     `running` when the runner died
 *
 * Both are control-lane tasks so they run even when workers are saturated or
 * the runner itself is paused.
 */

import { ParamError } from "../../errors.js";
import { toJsonColumn } from "../../utils/index.js";
import { AbstractTask } from "../AbstractTask.js";
import { queueToTableNames } from "../taskUtils.js";

/**
 * A pause enqueued before resume must not park the run the operator just
 * started. `resumedAt` is written by resumeTask and survives progress updates
 * that keep the previous object.
 *
 * @param {object} row
 * @param {unknown} requestedAt pauseTask row `created_at`
 * @returns {boolean}
 */
function pauseWasSuperseded(row, requestedAt) {
    const resumedMs = Date.parse(parseProgressObject(row?.progress).resumedAt);
    const requestedMs = requestedAt instanceof Date ? requestedAt.getTime() : Date.parse(requestedAt);
    if (!Number.isFinite(resumedMs) || !Number.isFinite(requestedMs)) return false;
    return resumedMs > requestedMs;
}

function parseProgressObject(progress) {
    if (progress == null || progress === "") return {};
    if (typeof progress === "object" && !Array.isArray(progress)) {
        return { ...progress };
    }
    if (typeof progress === "string") {
        const t = progress.trim();
        if (t.startsWith("{") || t.startsWith("[")) {
            try {
                const parsed = JSON.parse(t);
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return { ...parsed };
            } catch {
                /* keep as message */
            }
        }
        return { message: progress };
    }
    return { message: String(progress) };
}

/**
 * @param {object} context
 * @param {string} taskId
 * @returns {Promise<{ success: boolean, results: object }>}
 */
export async function applyPauseTask(context, taskId, options = {}) {
    const db = context.db;
    if (!db) throw new Error("pauseTask: context.db is required");
    const id = String(taskId ?? "").trim();
    if (!id) throw new ParamError('pauseTask: param "taskId" is required');

    const { tasksTable } = queueToTableNames(context.tasksQueueName ?? "tasks");
    const row = await db(tasksTable).where({ id }).first();
    if (!row) {
        return { success: false, results: { error: `Task ${id} not found`, taskId: id } };
    }

    if (pauseWasSuperseded(row, options.requestedAt)) {
        context.logger?.warn?.(
            `[pauseTask] ${id} (${row.name}) was resumed after this pause — left ${row.status}`,
        );
        return {
            success: true,
            results: {
                taskId: id,
                status: row.status,
                skipped: true,
                message: "Pause ignored — task was resumed after this pause",
            },
        };
    }

    if (row.status === "paused") {
        return {
            success: true,
            results: { taskId: id, status: "paused", message: "Task already paused" },
        };
    }

    if (row.status === "idle" || row.status === "waiting") {
        const progress = parseProgressObject(row.progress);
        progress.pauseRequested = true;
        progress.pausedAt = new Date().toISOString();
        await db(tasksTable).where({ id }).update({
            status: "paused",
            status_changed_at: db.fn.now(),
            progress: toJsonColumn(progress),
        });
        context.logger?.warn?.(`[pauseTask] ${row.status} task ${id} (${row.name}) → paused`);
        return {
            success: true,
            results: {
                taskId: id,
                status: "paused",
                message: row.status === "waiting" ? "Waiting task paused" : "Idle task paused",
            },
        };
    }

    if (row.status === "running") {
        const allowance = Number(options.stopAllowance);
        const stopAllowance = Number.isFinite(allowance) && allowance > 0 ? allowance : 30;
        const progress = parseProgressObject(row.progress);
        progress.pauseRequested = true;
        progress.pauseRequestedAt = new Date().toISOString();
        progress.stopAllowance = stopAllowance;
        await db(tasksTable).where({ id }).update({
            progress: toJsonColumn(progress),
        });

        const inst = context.runningTaskInstances?.get?.(id);
        if (inst && typeof inst.requestPause === "function") {
            await inst.requestPause(stopAllowance);
            context.logger?.warn?.(
                `[pauseTask] signaled running task ${id} (${row.name}) to pause after current unit`,
            );
            return {
                success: true,
                results: {
                    taskId: id,
                    status: "running",
                    signaled: true,
                    message: "Pause requested; task will finish current unit then park as paused",
                },
            };
        }

        context.logger?.warn?.(
            `[pauseTask] stamped pauseRequested on ${id} (${row.name}) — not running in this process`,
        );
        return {
            success: true,
            results: {
                taskId: id,
                status: "running",
                signaled: false,
                message:
                    "pauseRequested stamped on task row; target runner must observe it (enqueue pauseTask on that service)",
            },
        };
    }

    return {
        success: false,
        results: {
            error: `Cannot pause task in status "${row.status}"`,
            taskId: id,
            status: row.status,
        },
    };
}

/**
 * @param {object} context
 * @param {string} taskId
 * @returns {Promise<{ success: boolean, results: object }>}
 */
export async function applyResumeTask(context, taskId) {
    const db = context.db;
    if (!db) throw new Error("resumeTask: context.db is required");
    const id = String(taskId ?? "").trim();
    if (!id) throw new ParamError('resumeTask: param "taskId" is required');

    const { tasksTable } = queueToTableNames(context.tasksQueueName ?? "tasks");
    const row = await db(tasksTable).where({ id }).first();
    if (!row) {
        return { success: false, results: { error: `Task ${id} not found`, taskId: id } };
    }

    if (row.status === "idle") {
        return {
            success: true,
            results: { taskId: id, status: "idle", message: "Task already idle (runnable)" },
        };
    }

    if (row.status !== "paused") {
        return {
            success: false,
            results: {
                error: `Cannot resume task in status "${row.status}" (expected paused)`,
                taskId: id,
                status: row.status,
            },
        };
    }

    const progress = parseProgressObject(row.progress);
    delete progress.pauseRequested;
    delete progress.pauseRequestedAt;
    delete progress.pausedAt;
    progress.resumedAt = new Date().toISOString();

    const now = new Date();
    await db(tasksTable).where({ id }).update({
        status: "idle",
        status_changed_at: db.fn.now(),
        started_at: null,
        completed_at: null,
        success: null,
        progress: toJsonColumn(progress),
        // Clear claim binding so any matching worker can pick it up.
        service_name: null,
        server_name: null,
        instance_number: null,
        // Claim skips scheduled rows until cron matches unless past_due is set.
        next_run_at: now,
        past_due: now,
    });

    const dropped = await dropEarlierPauseCommands(context, tasksTable, id);
    const droppedNote = dropped > 0 ? `; dropped ${dropped} earlier pause command(s)` : "";
    context.logger?.warn?.(`[resumeTask] paused task ${id} (${row.name}) → idle (run now)${droppedNote}`);
    return {
        success: true,
        results: {
            taskId: id,
            status: "idle",
            droppedPauseCommands: dropped,
            message: "Task resumed (idle; will be claimed now)",
        },
    };
}

/**
 * Pause commands still in the queue (including one stuck `running` on a dead
 * runner) would park this task again after it is claimed.
 *
 * @returns {Promise<number>}
 */
async function dropEarlierPauseCommands(context, tasksTable, taskId) {
    const db = context.db;
    try {
        const dropped = await db(tasksTable)
            .where({ name: "pauseTask" })
            .whereIn("status", ["idle", "waiting", "running"])
            .whereRaw("(params->>'taskId') = ?", [taskId])
            .delete();
        const n = Number(dropped) || 0;
        if (n > 0) {
            context.logger?.warn?.(
                `[resumeTask] dropped ${n} earlier pause command(s) for ${taskId}`,
            );
        }
        return n;
    } catch (err) {
        context.logger?.warn?.(
            `[resumeTask] could not drop earlier pause commands for ${taskId}: ${err?.message ?? err}`,
        );
        return 0;
    }
}

export class TaskPauseTask extends AbstractTask {
    static taskName = "pauseTask";
    static description = "Pause a specific task: finish current unit, persist status=paused";
    static defaultWaitForResult = true;

    static async resolveCustomParams(context, overrides = {}) {
        const merged = AbstractTask._mergeTypedParams(
            context,
            "task-pause-task",
            { taskId: "string", stopAllowance: "number default 30" },
            overrides,
        );
        const taskId = typeof merged.taskId === "string" ? merged.taskId.trim() : "";
        if (!taskId) throw new ParamError('pauseTask: param "taskId" is required');
        const allowance = Number(merged.stopAllowance);
        return {
            taskId,
            stopAllowance: Number.isFinite(allowance) && allowance > 0 ? allowance : 30,
        };
    }

    async run() {
        return applyPauseTask(this.context, this.task?.params?.taskId, {
            stopAllowance: this.task?.params?.stopAllowance,
            requestedAt: this.task?.created_at,
        });
    }
}

export class TaskResumeTask extends AbstractTask {
    static taskName = "resumeTask";
    static description = "Resume a paused task (status paused → idle)";
    static defaultWaitForResult = true;

    static async resolveCustomParams(context, overrides = {}) {
        const merged = AbstractTask._mergeTypedParams(
            context,
            "task-resume-task",
            { taskId: "string" },
            overrides,
        );
        const taskId = typeof merged.taskId === "string" ? merged.taskId.trim() : "";
        if (!taskId) throw new ParamError('resumeTask: param "taskId" is required');
        return { taskId };
    }

    async run() {
        return applyResumeTask(this.context, this.task?.params?.taskId);
    }
}
