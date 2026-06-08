import { randomUUID } from "node:crypto";
import { toJsonColumn } from "../utils/index.js";
import { nextTimeMatch } from "./time-matcher.js";

//KEEP THIS FOR REFERENCE !!!
// this is a sample of how to add a column to a table if it does not exist
// const tasksHasOpid = await db.schema.hasColumn(tasksTable, "opid");
// if (!tasksHasOpid) {
//     await db.schema.alterTable(tasksTable, (t) => {
//         t.text("opid");
//     });
// }


/**
 * Fail-fast accessor for the knex instance on `context.db`. The tasks component
 * assumes the DB is already initialized by the caller — we don't lazy-init here,
 * so a missing `db` is a programming error, not a runtime condition.
 *
 * @param {object} context
 * @returns {Function} knex instance
 */
function getDb(context) {
    const db = context.db;
    if (!db) {
        throw new Error("Tasks component requires context.db. Initialize DB first and attach to context.");
    }
    return db;
}

/**
 * Given a queue name, derive the three related table names the runtime uses:
 *
 *   - `tasksTable`     — active queue (rows that may still run)
 *   - `historyTable`   — append-only audit of completed attempts
 *   - `registryTable`  — live service/runner heartbeats for the queue
 *
 * @param {string} queueName
 * @returns {{ tasksTable: string, historyTable: string, registryTable: string }}
 */
export function queueToTableNames(queueName) {
    return {
        tasksTable: queueName,
        historyTable: `${queueName}_history`,
        registryTable: `${queueName}_services_registry`,
    };
}

/**
 * Column definition shared by the active queue and its history mirror. Kept in
 * one place so the two tables stay structurally compatible (history receives a
 * full row snapshot).
 *
 * @param {import("knex").Knex.CreateTableBuilder} t
 * @param {import("knex").Knex} db
 * @param {string} tableNameForIndex Used to name indexes uniquely per table.
 */
function defineTasksTable(t, db, tableNameForIndex) {
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
    t.jsonb("params");

    // those are tagret identifiers, kind of who is going to run a task.
    t.text("service_group"); // harvester, loader, photos, ...
    t.integer("instance_number");
    t.text("service_name"); // that's a "<server_name>_<service_group>_<instance_number>"
    t.text("server_name"); // filled by runner when registering, auto.

    t.text("status").notNullable().defaultTo("idle"); // idle, running, completed, failed, paused
    t.timestamp("status_changed_at").defaultTo(null);

    t.text("progress");
    t.boolean("success");
    t.jsonb("results");

    t.index(["service_group", "status", "priority", "created_at"], `${tableNameForIndex}_claim_idx`);
    t.index(["service_group", "name"], `${tableNameForIndex}_group_name_idx`);
}

/**
 * Build an insert payload for `*_history`: never copies the queue row `id` as the history PK — PostgreSQL default
 * generates a new `id`. The snapshot still carries `name`, `opid`, `params`, etc. for auditing and ad hoc queries.
 *
 * @param {object} row      Original queue row.
 * @param {object} overrides Fields to override on the snapshot (e.g. `completed_at`, `success`).
 * @returns {object}
 */
export function taskHistoryInsertFromQueueRow(row, overrides) {
    const { id, ...snapshot } = row;
    void id;
    return {
        ...snapshot,
        ...overrides,
    };
}

/**
 * Idempotently create the three tables backing a queue (tasks / history / registry).
 * Pass `recreate: true` to drop-and-recreate, useful in dev/test.
 *
 * Pass `dryRun: true` to only report the DDL it *would* run (drops/creates) and
 * make no changes — so a `--dryRun` script never mutates the schema.
 *
 * Requires the `uuid-ossp` extension; creates it on first run if missing.
 *
 * @param {object} context
 * @param {{ queueName?: string, recreate?: boolean, dryRun?: boolean }} [options]
 * @returns {Promise<void>}
 */
export async function ensureTaskTables(context, options = {}) {
    const queueName = options.queueName ?? "tasks";
    const recreate = options.recreate ?? false;
    const dryRun = options.dryRun ?? false;
    const db = getDb(context);
    const log = context.logger ?? console;
    const { tasksTable, historyTable, registryTable } = queueToTableNames(queueName);

    const needsTasks = recreate ? true : !(await db.tableExists(tasksTable));
    const needsHistory = recreate ? true : !(await db.tableExists(historyTable));
    const needsRegistry = recreate ? true : !(await db.tableExists(registryTable));

    if (dryRun) {
        const plan = [];
        if (recreate) {
            plan.push(`DROP TABLE IF EXISTS ${historyTable}, ${tasksTable}, ${registryTable}`);
        }
        if (needsTasks) plan.push(`CREATE TABLE ${tasksTable} (tasks queue)`);
        if (needsHistory) plan.push(`CREATE TABLE ${historyTable} (history mirror)`);
        if (needsRegistry) plan.push(`CREATE TABLE ${registryTable} (services registry)`);
        if (plan.length === 0) {
            log.info?.(`[tasks-schema] dryRun — queue "${queueName}" already up to date; no DDL`);
        } else {
            log.info?.(`[tasks-schema] dryRun — would run ${plan.length} statement(s) for queue "${queueName}":`);
            for (const s of plan) log.info?.(`  - ${s}`);
        }
        return;
    }

    if (recreate) {
        await db.schema.dropTableIfExists(historyTable);
        await db.schema.dropTableIfExists(tasksTable);
        await db.schema.dropTableIfExists(registryTable);
    }

    if (needsTasks) {
        await db.raw(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
        await db.schema.createTable(tasksTable, (t) => {
            defineTasksTable(t, db, tasksTable);
        });
    }

    if (needsHistory) {
        await db.schema.createTable(historyTable, (t) => {
            defineTasksTable(t, db, historyTable);
        });
    }

    if (needsRegistry) {
        await db.schema.createTable(registryTable, (t) => {
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

/**
 * Insert one task row into the queue. Supports targeting (service_group + optional
 * instance/server), recurring schedules (cron-like 6-field string, see `time-matcher.js`),
 * and explicit `nextRunAt` overrides.
 *
 * @param {object} context
 * @param {{
 *   queueName?: string,
 *   name?: string,
 *   task?: string,
 *   params?: unknown,
 *   opid?: string|null,
 *   priority?: number,
 *   schedule?: string|null,
 *   nextRunAt?: Date|string|number|null,
 *   serviceGroup?: string|null,
 *   instanceNumber?: number|null,
 *   serviceName?: string|null,
 *   serverName?: string|null,
 * }} options
 * @returns {Promise<string>} The new task's UUID.
 */
export async function enqueueTask(context, options) {
    const db = getDb(context);
    const queueName = options.queueName ?? "tasks";
    const { tasksTable } = queueToTableNames(queueName);
    const id = randomUUID();

    const name = options.name ?? options.task;
    if (!name) {
        throw new Error("enqueueTask: name (or task) is required");
    }

    const schedule = options.schedule?.trim() ? options.schedule : null;
    let nextRunAt = null;
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

/**
 * Update the `progress` column for one task. Strings go in verbatim; anything
 * else gets JSON-stringified so the column stays text-friendly.
 *
 * @param {object} context
 * @param {string} tasksTable
 * @param {string} taskId
 * @param {unknown} progress
 * @returns {Promise<void>}
 */
export async function updateTaskProgress(context, tasksTable, taskId, progress) {
    const db = getDb(context);
    await db(tasksTable).where({ id: taskId }).update({
        progress: typeof progress === "string" ? progress : JSON.stringify(progress),
    });
}
