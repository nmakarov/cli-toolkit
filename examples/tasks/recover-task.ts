#!/usr/bin/env node

import { init } from "../../src/init/index.js";
import { dbInit } from "../../src/db/index.js";
import { appendTaskIpcLog, ensureTaskTables, queueToTableNames } from "../../src/tasks/index.js";
import type { TaskInstance, TaskResult, TaskRow } from "../../src/tasks/types.js";
import { toJsonColumn } from "../../src/utils/index.js";
import { createExampleTasksRegistry } from "./customTasksRegistry.js";

const LOCKED_BY_ERROR_MESSAGE = "locked by error";

const defs = {
    dbName: "string default local",
    table: "string default tasks",
    id: "string required",
};

type DbLike = any;

function parseTaskParams(value: any): Record<string, any> | null {
    if (!value) return null;
    if (typeof value === "object") return value;
    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === "object" ? parsed : null;
        } catch {
            return null;
        }
    }
    return null;
}

async function executeManualRecovery(
    context: any,
    db: DbLike,
    tasksTable: string,
    historyTable: string,
    row: TaskRow
): Promise<void> {
    const registry = createExampleTasksRegistry();
    const TaskClass = registry.get(row.task);
    if (!TaskClass) {
        throw new Error(`Task "${row.task}" is not registered in examples/tasks/customTasksRegistry.ts`);
    }
    if (row.started_at) {
        throw new Error(`Task ${row.id} is already running (started_at is set).`);
    }

    const startedAt = new Date();
    await db(tasksTable).where({ id: row.id }).update({
        started_at: startedAt,
        completed_at: null,
        success: null,
        progress: "recovery in progress",
        past_due: null,
    });

    const taskForRun: TaskRow = {
        ...row,
        params: parseTaskParams(row.params),
        started_at: startedAt,
    };

    let success = false;
    let results: any = null;
    let taskInstance: TaskInstance | null = null;
    try {
        taskInstance = new TaskClass(context, taskForRun);
        const runResult: TaskResult = await taskInstance.run(async (progress: any) => {
            await db(tasksTable).where({ id: row.id }).update({
                progress: typeof progress === "string" ? progress : JSON.stringify(progress),
            });
        });
        success = !!runResult?.success;
        results = runResult?.results ?? null;
    } catch (error: any) {
        success = false;
        results = {
            message: error?.message ?? String(error),
            name: error?.name ?? "Error",
            stack: error?.stack ?? null,
        };
    }

    const { paused_at: _pausedAt, ...rowForHistory } = taskForRun as any;
    await db(historyTable).insert({
        ...rowForHistory,
        completed_at: new Date(),
        success,
        params: toJsonColumn(taskForRun.params),
        results: toJsonColumn(results),
    });

    if (success) {
        await db(tasksTable).where({ id: row.id }).update({
            started_at: null,
            completed_at: new Date(),
            success: true,
            results: toJsonColumn(results),
            paused_at: null,
            progress: null,
            past_due: null,
        });
        context.logger.info?.(`[recover-task] success id=${row.id} task=${row.task}`);
        return;
    }

    await db(tasksTable).where({ id: row.id }).update({
        started_at: null,
        completed_at: new Date(),
        success: false,
        results: toJsonColumn(results),
        paused_at: db.fn.now(),
        progress: LOCKED_BY_ERROR_MESSAGE,
        past_due: null,
    });
    appendTaskIpcLog(context, row, {
        level: "error",
        message: `[recover-task] task failed again and remains locked: ${row.task} id=${row.id}`,
        details: results,
    });
    throw new Error(`[recover-task] failed id=${row.id} task=${row.task}`);
}

const flow = async (context: any) => {
    const { dbName, table, id } = context.params.getAll(defs);
    const db = await dbInit(context, dbName);
    const dbCall = db as any;
    context.db = db;
    await ensureTaskTables(context, { queue: table, recreate: false });
    const { tasksTable, historyTable } = queueToTableNames(table);

    const row = await dbCall(tasksTable).where({ id }).first() as TaskRow | undefined;
    if (!row) {
        const fromHistory = await dbCall(historyTable).where({ id }).orderBy("created_at", "desc").first();
        if (fromHistory) {
            throw new Error(`Task id=${id} is not in active queue (${tasksTable}); found in history only.`);
        }
        throw new Error(`Task id=${id} not found in queue "${tasksTable}".`);
    }

    await executeManualRecovery(context, dbCall, tasksTable, historyTable, row);
};

void init(flow);
