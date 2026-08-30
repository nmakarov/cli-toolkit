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
 *
 * Both are control-lane tasks so they run even when workers are saturated or
 * the runner itself is paused.
 */

import { ParamError } from "../../errors.js";
import { toJsonColumn } from "../../utils/index.js";
import { AbstractTask } from "../AbstractTask.js";
import { queueToTableNames } from "../taskUtils.js";

/**
 * @param {unknown} progress
 * @returns {Record<string, unknown>}
 */
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
export async function applyPauseTask(context, taskId) {
    const db = context.db;
    if (!db) throw new Error("pauseTask: context.db is required");
    const id = String(taskId ?? "").trim();
    if (!id) throw new ParamError('pauseTask: param "taskId" is required');

    const { tasksTable } = queueToTableNames(context.tasksQueueName ?? "tasks");
    const row = await db(tasksTable).where({ id }).first();
    if (!row) {
        return { success: false, results: { error: `Task ${id} not found`, taskId: id } };
    }

    if (row.status === "paused") {
        return {
            success: true,
            results: { taskId: id, status: "paused", message: "Task already paused" },
        };
    }

    if (row.status === "idle") {
        const progress = parseProgressObject(row.progress);
        progress.pauseRequested = true;
        progress.pausedAt = new Date().toISOString();
        await db(tasksTable).where({ id }).update({
            status: "paused",
            status_changed_at: db.fn.now(),
            progress: toJsonColumn(progress),
        });
        context.logger?.warn?.(`[pauseTask] idle task ${id} (${row.name}) → paused`);
        return {
            success: true,
            results: { taskId: id, status: "paused", message: "Idle task paused" },
        };
    }

    if (row.status === "running") {
        const progress = parseProgressObject(row.progress);
        progress.pauseRequested = true;
        progress.pauseRequestedAt = new Date().toISOString();
        await db(tasksTable).where({ id }).update({
            progress: toJsonColumn(progress),
        });

        const inst = context.runningTaskInstances?.get?.(id);
        if (inst && typeof inst.requestPause === "function") {
            await inst.requestPause();
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

    context.logger?.warn?.(`[resumeTask] paused task ${id} (${row.name}) → idle (run now)`);
    return {
        success: true,
        results: { taskId: id, status: "idle", message: "Task resumed (idle; will be claimed now)" },
    };
}

export class TaskPauseTask extends AbstractTask {
    static taskName = "pauseTask";
    static description = "Pause a specific task: finish current unit, persist status=paused";
    static defaultWaitForResult = true;

    static async resolveCustomParams(context, overrides = {}) {
        const merged = AbstractTask._mergeTypedParams(
            context,
            "task-pause-task",
            { taskId: "string" },
            overrides,
        );
        const taskId = typeof merged.taskId === "string" ? merged.taskId.trim() : "";
        if (!taskId) throw new ParamError('pauseTask: param "taskId" is required');
        return { taskId };
    }

    async run() {
        return applyPauseTask(this.context, this.task?.params?.taskId);
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
