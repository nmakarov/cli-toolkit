import { randomUUID } from "node:crypto";
import type { Context } from "../init/types.js";
import { toJsonColumn } from "../utils/index.js";
import type { EnqueueTaskOptions, EnsureTaskTablesOptions, TaskRow } from "./types.js";
import { nextTimeMatch } from "./time-matcher.js";

type DbLike = any;

//KEEP THIS FOR REFERENCE !!!
// this is a sample of how to add a column to a table if it does not exist
// const tasksHasOpid = await db.schema.hasColumn(tasksTable, "opid");
// if (!tasksHasOpid) {
//     await db.schema.alterTable(tasksTable, (t: any) => {
//         t.text("opid");
//     });
// }


function getDb(context: Context): DbLike {
    const db = context.db;
    if (!db) {
        throw new Error("Tasks component requires context.db. Initialize DB first and attach to context.");
    }
    return db as DbLike;
}

export function queueToTableNames(queueName: string): {
    tasksTable: string;
    historyTable: string;
    registryTable: string;
} {
    return {
        tasksTable: queueName,
        historyTable: `${queueName}_history`,
        registryTable: `${queueName}_services_registry`,
    };
}

function defineTasksTable(t: any, db: DbLike, tableNameForIndex: string) {
    t.uuid("id").primary().defaultTo(db.raw("uuid_generate_v4()"));
    t.timestamp("created_at").notNullable().defaultTo(db.fn.now());
    t.timestamp("started_at");
    t.timestamp("completed_at");
    /*
     * Priority: lower number = claimed first (see claimNextRunnableTask: ORDER BY priority ASC).
     * Suggested range 0–100: 0 = most urgent, 100 = least; default 50 for normal work.
     */
    t.integer("priority").notNullable().defaultTo(50);

    t.text("schedule");
    t.timestamp("next_run_at").defaultTo(null);
    t.timestamp("past_due").defaultTo(null);

    t.text("name").notNullable();
    t.text("opid");
    t.json("params");

    // those are tagret identifiers, kind of who is going to run a task.
    t.text("service_group"); // harvester, loader, photos, ...
    t.integer("instance_number");
    t.text("service_name"); // that's a "<server_name>_<service_group>_<instance_number>"
    t.text("server_name"); // filled by runner when registering, auto.

    t.text("status").notNullable().defaultTo("idle"); // idle, running, completed, failed, paused
    t.timestamp("status_changed_at").defaultTo(null);

    t.text("progress");
    t.boolean("success");
    t.json("results");

    t.index(["service_group", "status", "priority", "created_at"], `${tableNameForIndex}_claim_idx`);
    t.index(["service_group", "name"], `${tableNameForIndex}_group_name_idx`);
}

/**
 * Build an insert payload for `*_history`: never copies the queue row `id` as the history PK — PostgreSQL default
 * generates a new `id`. The snapshot still carries `name`, `opid`, `params`, etc. for auditing and ad hoc queries.
 */
export function taskHistoryInsertFromQueueRow(row: TaskRow, overrides: Record<string, unknown>): Record<string, unknown> {
    const { id, ...snapshot } = row;
    void id;
    return {
        ...snapshot,
        ...overrides,
    };
}

export async function ensureTaskTables(context: Context, options: EnsureTaskTablesOptions = {}): Promise<void> {
    const queueName = options.queueName ?? "tasks";
    const recreate = options.recreate ?? false;
    const db = getDb(context);
    const { tasksTable, historyTable, registryTable } = queueToTableNames(queueName);

    const needsTasks = recreate ? true : !(await db.tableExists(tasksTable));
    const needsHistory = recreate ? true : !(await db.tableExists(historyTable));
    const needsRegistry = recreate ? true : !(await db.tableExists(registryTable));

    if (recreate) {
        await db.schema.dropTableIfExists(historyTable);
        await db.schema.dropTableIfExists(tasksTable);
        await db.schema.dropTableIfExists(registryTable);
    }

    if (needsTasks) {
        await db.raw(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
        await db.schema.createTable(tasksTable, (t: any) => {
            defineTasksTable(t, db, tasksTable);
        });
    }

    if (needsHistory) {
        await db.schema.createTable(historyTable, (t: any) => {
            defineTasksTable(t, db, historyTable);
        });
    }

    if (needsRegistry) {
        await db.schema.createTable(registryTable, (t: any) => {
            t.uuid("id").primary().defaultTo(db.raw("uuid_generate_v4()"));

            t.text("queue_name").notNullable();
            t.text("service_group").notNullable(); // harvester, loader, photos, ...
            t.integer("instance_number").notNullable().defaultTo(1);
            t.text("service_name").notNullable(); // that's a "<server_name>_<service_group>_<instance_number>"
            t.text("server_name").notNullable(); // filled by runner when registering, auto.
            t.integer("pid");

            t.json("metadata");

            t.timestamp("created_at").notNullable().defaultTo(db.fn.now());
            t.timestamp("last_seen_at").notNullable().defaultTo(db.fn.now());
            t.unique(["queue_name", "service_name"], `${registryTable}_queue_name_service_name_uniq`);
            t.index(["queue_name", "service_group", "last_seen_at"], `${registryTable}_queue_group_seen_idx`);
            t.index(["queue_name", "last_seen_at"], `${registryTable}_queue_seen_idx`);
        });

        // TODO: a reference is needed - task_history entry should reference the registry entry, so that we can easily find all executed tasks for a given service and calculate the average workload or identify if there's a bottleneck. Also may be used for the load balancing.
    }
}

export async function enqueueTask(context: Context, options: EnqueueTaskOptions): Promise<string> {
    const db = getDb(context);
    const queueName = options.queueName ?? "tasks";
    const { tasksTable } = queueToTableNames(queueName);
    const id = randomUUID();

    const name = options.name ?? options.task;
    if (!name) {
        throw new Error("enqueueTask: name (or task) is required");
    }

    const schedule = options.schedule?.trim() ? options.schedule : null;
    let nextRunAt: Date | null = null;
    if (options.nextRunAt !== undefined) {
        nextRunAt = options.nextRunAt == null ? null : new Date(options.nextRunAt);
    } else if (schedule) {
        nextRunAt = nextTimeMatch(schedule, new Date());
    }

    await db(tasksTable).insert({
        id,
        name,
        params: toJsonColumn(options.params ?? null),
        opid: options.opid ?? null,
        priority: options.priority ?? 50,
        schedule,
        next_run_at: nextRunAt,
        service_group: options.serviceGroup ?? null,
        instance_number: options.instanceNumber ?? null,
        service_name: options.serviceName ?? null,
        server_name: options.serverName ?? null,
        status: "idle",
        status_changed_at: db.fn.now(),
    });
    return id;
}

export async function updateTaskProgress(context: Context, tasksTable: string, taskId: string, progress: any): Promise<void> {
    const db = getDb(context);
    await db(tasksTable).where({ id: taskId }).update({
        progress: typeof progress === "string" ? progress : JSON.stringify(progress),
    });
}
