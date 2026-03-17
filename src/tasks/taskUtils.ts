import { randomUUID } from "node:crypto";
import type { Context } from "../init/types.js";
import { toJsonColumn } from "../utils/index.js";
import type { EnqueueTaskOptions, EnsureTaskTablesOptions } from "./types.js";

type DbLike = any;

function getDb(context: Context): DbLike {
    const db = (context as any).db;
    if (!db) {
        throw new Error("Tasks component requires context.db. Initialize DB first and attach to context.");
    }
    return db;
}

export function queueToTableNames(queue: string): { tasksTable: string; historyTable: string } {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(queue)) {
        throw new Error(`Invalid queue name "${queue}". Use letters, numbers, underscore only.`);
    }
    return {
        tasksTable: queue,
        historyTable: `${queue}_history`,
    };
}

export async function ensureTaskTables(context: Context, options: EnsureTaskTablesOptions = {}): Promise<void> {
    const queue = options.queue ?? "tasks";
    const recreate = options.recreate ?? false;
    const db = getDb(context);
    const { tasksTable, historyTable } = queueToTableNames(queue);

    const needsTasks = recreate ? true : !(await db.tableExists(tasksTable));
    const needsHistory = recreate ? true : !(await db.tableExists(historyTable));

    if (recreate) {
        await db.schema.dropTableIfExists(historyTable);
        await db.schema.dropTableIfExists(tasksTable);
    }

    if (needsTasks) {
        await db.raw(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
        await db.schema.createTable(tasksTable, (t: any) => {
            t.uuid("id").primary().defaultTo(db.raw("uuid_generate_v4()"));
            t.timestamp("created_at").notNullable().defaultTo(db.fn.now());
            t.timestamp("started_at");
            t.timestamp("completed_at");
            t.integer("priority").notNullable().defaultTo(0);
            t.text("schedule");
            t.timestamp("past_due").defaultTo(null);
            t.text("target").notNullable();
            t.text("task").notNullable();
            t.json("params");
            t.text("opid");
            t.timestamp("paused_at").defaultTo(null);
            t.text("progress");
            t.boolean("success");
            t.json("results");
        });

        await db.schema.alterTable(tasksTable, (t: any) => {
            t.index(["target", "started_at", "created_at"], `${tasksTable}_target_started_created_idx`);
            t.index(["target", "past_due", "priority", "created_at"], `${tasksTable}_target_past_due_priority_created_idx`);
            t.index(["target", "task"], `${tasksTable}_target_task_idx`);
        });
    }
    const tasksHasOpid = await db.schema.hasColumn(tasksTable, "opid");
    if (!tasksHasOpid) {
        await db.schema.alterTable(tasksTable, (t: any) => {
            t.text("opid");
        });
    }
    const tasksHasPausedAt = await db.schema.hasColumn(tasksTable, "paused_at");
    if (!tasksHasPausedAt) {
        await db.schema.alterTable(tasksTable, (t: any) => {
            t.timestamp("paused_at").defaultTo(null);
        });
    }

    if (needsHistory) {
        await db.schema.createTable(historyTable, (t: any) => {
            t.uuid("id").notNullable();
            t.timestamp("created_at").notNullable();
            t.timestamp("started_at");
            t.timestamp("completed_at");
            t.integer("priority").notNullable().defaultTo(0);
            t.text("schedule");
            t.timestamp("past_due").defaultTo(null);
            t.text("target").notNullable();
            t.text("task").notNullable();
            t.json("params");
            t.text("opid");
            t.text("progress");
            t.boolean("success");
            t.json("results");
        });

        await db.schema.alterTable(historyTable, (t: any) => {
            t.index(["target", "created_at"], `${historyTable}_target_created_idx`);
            t.index(["task", "created_at"], `${historyTable}_task_created_idx`);
        });
    }
    const historyHasOpid = await db.schema.hasColumn(historyTable, "opid");
    if (!historyHasOpid) {
        await db.schema.alterTable(historyTable, (t: any) => {
            t.text("opid");
        });
    }
}

export async function enqueueTask(context: Context, options: EnqueueTaskOptions): Promise<string> {
    const db = getDb(context);
    const queue = options.queue ?? "tasks";
    const { tasksTable } = queueToTableNames(queue);
    const id = randomUUID();

    await db(tasksTable).insert({
        id,
        target: options.target,
        task: options.task,
        params: toJsonColumn(options.params ?? null),
        opid: options.opid ?? null,
        priority: options.priority ?? 0,
        schedule: options.schedule ?? null,
    });
    return id;
}

export async function updateTaskProgress(context: Context, tasksTable: string, taskId: string, progress: any): Promise<void> {
    const db = getDb(context);
    await db(tasksTable).where({ id: taskId }).update({
        progress: typeof progress === "string" ? progress : JSON.stringify(progress),
    });
}
