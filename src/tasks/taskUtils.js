import { randomUUID } from "node:crypto";
import { toJsonColumn } from "../utils/index.js";
import { ensureSchema } from "../db/ensure.js";
import { nextTimeMatch } from "./time-matcher.js";

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
 * Column set shared by the active queue and its history mirror, expressed as a
 * declarative spec (see db/ensure.js): each entry is one column, so
 * `ensureSchema` can create the whole table OR add just the columns an older
 * installation is missing — adding a field here is all a migration takes.
 *
 * @param {string} tableNameForIndex Used to name indexes uniquely per table.
 * @returns {import("../db/ensure.js").TableSpec}
 */
function tasksTableSpec(tableNameForIndex) {
    return {
        columns: {
            id: (t, db) => t.uuid("id").primary().defaultTo(db.raw("uuid_generate_v4()")),
            created_at: (t, db) => t.timestamp("created_at").notNullable().defaultTo(db.fn.now()),
            started_at: (t) => t.timestamp("started_at"),
            completed_at: (t) => t.timestamp("completed_at"),
            /*
             * Priority: lower number = more urgent (0 first, default 50). Used when no
             * row is due (`next_run_at` / `past_due`); due rows claim by earliest due.
             */
            priority: (t) => t.integer("priority").notNullable().defaultTo(50),

            schedule: (t) => t.text("schedule"),
            next_run_at: (t) => t.timestamp("next_run_at").defaultTo(null),
            past_due: (t) => t.timestamp("past_due").defaultTo(null),

            name: (t) => t.text("name").notNullable(),
            opid: (t) => t.text("opid"),
            params: (t) => t.jsonb("params"),

            // those are target identifiers, kind of who is going to run a task.
            service_group: (t) => t.text("service_group"), // harvester, loader, photos, ...
            instance_number: (t) => t.integer("instance_number"),
            service_name: (t) => t.text("service_name"), // that's a "<server_name>_<service_group>_<instance_number>"
            server_name: (t) => t.text("server_name"), // filled by runner when registering, auto.

            status: (t) => t.text("status").notNullable().defaultTo("idle"), // idle, running, completed, failed, paused
            status_changed_at: (t) => t.timestamp("status_changed_at").defaultTo(null),

            progress: (t) => t.text("progress"),
            success: (t) => t.boolean("success"),
            results: (t) => t.jsonb("results"),
        },
        indexes: [
            {
                columns: ["service_group", "status", "priority", "created_at"],
                name: `${tableNameForIndex}_claim_idx`,
            },
            { columns: ["service_group", "name"], name: `${tableNameForIndex}_group_name_idx` },
            { columns: ["completed_at"], name: `${tableNameForIndex}_completed_at_idx` },
        ],
    };
}

/**
 * Spec for the services registry table of a queue.
 *
 * @param {string} registryTable
 * @returns {import("../db/ensure.js").TableSpec}
 */
function registryTableSpec(registryTable) {
    return {
        columns: {
            id: (t, db) => t.uuid("id").primary().defaultTo(db.raw("uuid_generate_v4()")),

            queue_name: (t) => t.text("queue_name").notNullable(),
            service_group: (t) => t.text("service_group").notNullable(), // harvester, loader, photos, ...
            instance_number: (t) => t.integer("instance_number").notNullable().defaultTo(1),
            service_name: (t) => t.text("service_name").notNullable(), // that's a "<server_name>_<service_group>_<instance_number>"
            server_name: (t) => t.text("server_name").notNullable(), // filled by runner when registering, auto.
            pid: (t) => t.integer("pid"),

            metadata: (t) => t.json("metadata"),

            created_at: (t, db) => t.timestamp("created_at").notNullable().defaultTo(db.fn.now()),
            last_seen_at: (t, db) => t.timestamp("last_seen_at").notNullable().defaultTo(db.fn.now()),
        },
        indexes: [
            {
                columns: ["queue_name", "service_name"],
                name: `${registryTable}_queue_name_service_name_uniq`,
                unique: true,
            },
            {
                columns: ["queue_name", "service_group", "last_seen_at"],
                name: `${registryTable}_queue_group_seen_idx`,
            },
            { columns: ["queue_name", "last_seen_at"], name: `${registryTable}_queue_seen_idx` },
        ],
        // TODO: a reference is needed - task_history entry should reference the registry entry, so that we can easily find all executed tasks for a given service and calculate the average workload or identify if there's a bottleneck. Also may be used for the load balancing.
    };
}

/**
 * Full schema spec for one queue: active table + history mirror + registry.
 * Exported so callers (and tests) can feed it to `ensureSchema` /
 * `ensureSchemaEverywhere` directly.
 *
 * @param {string} [queueName]
 * @returns {import("../db/ensure.js").SchemaSpec}
 */
export function tasksSchemaSpec(queueName = "tasks") {
    const { tasksTable, historyTable, registryTable } = queueToTableNames(queueName);
    return {
        extensions: ["uuid-ossp"],
        tables: {
            [tasksTable]: tasksTableSpec(tasksTable),
            [historyTable]: tasksTableSpec(historyTable),
            [registryTable]: registryTableSpec(registryTable),
        },
    };
}

/**
 * Build an insert payload for `*_history`: never copies the queue row `id` as the history PK — PostgreSQL default
 * generates a new `id`. The snapshot still carries `name`, `opid`, `params`, etc. for auditing and ad hoc queries.
 *
 * When the queue row has no `opid`, we stamp `opid` with the queue row id so
 * {@link waitForTaskResult} can correlate history after the queue row is deleted
 * (history PK ≠ queue id). Explicit `opid` on the row or in `overrides` wins.
 *
 * @param {object} row      Original queue row.
 * @param {object} overrides Fields to override on the snapshot (e.g. `completed_at`, `success`).
 * @returns {object}
 */
export function taskHistoryInsertFromQueueRow(row, overrides = {}) {
    const { id, ...snapshot } = row;
    const opid =
        overrides.opid !== undefined
            ? overrides.opid
            : snapshot.opid != null && String(snapshot.opid).trim() !== ""
              ? snapshot.opid
              : id;
    return {
        ...snapshot,
        ...overrides,
        opid,
    };
}

/**
 * Idempotently make the three tables backing a queue (tasks / history /
 * registry) match the current spec — on one database or on many.
 *
 * Spec-driven (see {@link tasksSchemaSpec} + db/ensure.js), so this covers
 * BOTH cases: a missing table is created whole, and a table created by an
 * older version gets its missing columns/indexes added (never dropped or
 * altered in place).
 *
 * Multi-database: pass `databases: [handle, handle, ...]` (e.g. from
 * `Db.initAllSiblings(context, { prefix: "src_", includeMain: true })`) to
 * apply the same ensure to every database currently in use. Default stays
 * `context.db` only.
 *
 * Other options:
 *   - `recreate: true` — drop-and-recreate (dev/test only).
 *   - `dryRun: true`   — report the DDL it *would* run, change nothing.
 *
 * Requires the `uuid-ossp` extension; created on the fly if missing.
 *
 * @param {object} context
 * @param {{ queueName?: string, recreate?: boolean, dryRun?: boolean, databases?: Function[] }} [options]
 * @returns {Promise<void>}
 */
export async function ensureTaskTables(context, options = {}) {
    const queueName = options.queueName ?? "tasks";
    const recreate = options.recreate ?? false;
    const dryRun = options.dryRun ?? false;
    const databases = options.databases ?? [getDb(context)];
    const log = context.logger ?? console;
    const { tasksTable, historyTable, registryTable } = queueToTableNames(queueName);
    const spec = tasksSchemaSpec(queueName);

    for (const db of databases) {
        const label = db?.config?.name ?? "db";

        if (recreate) {
            if (dryRun) {
                log.info?.(
                    `[tasks-schema] dryRun — ${label}: DROP TABLE IF EXISTS ${historyTable}, ${tasksTable}, ${registryTable}`,
                );
            } else {
                await db.schema.dropTableIfExists(historyTable);
                await db.schema.dropTableIfExists(tasksTable);
                await db.schema.dropTableIfExists(registryTable);
            }
        }

        const { actions } = await ensureSchema(db, spec, { dryRun, logger: context.logger });

        // Older schemas had NOT NULL "task" (renamed to "name"). ensureSchema only
        // adds columns, so a hybrid table breaks enqueueTask inserts into "name".
        const legacyDrops = await dropLegacyTaskNameColumn(db, [tasksTable, historyTable], {
            dryRun,
            log,
            label,
        });

        const allActions = [...actions, ...legacyDrops];
        if (dryRun) {
            if (allActions.length === 0) {
                log.info?.(`[tasks-schema] dryRun — ${label}: queue "${queueName}" already up to date; no DDL`);
            } else {
                log.info?.(
                    `[tasks-schema] dryRun — ${label}: would run ${allActions.length} statement(s) for queue "${queueName}":`,
                );
                for (const s of allActions) log.info?.(`  - ${s}`);
            }
        } else if (allActions.length > 0) {
            log.info?.(
                `[tasks-schema] ${label}: applied ${allActions.length} DDL statement(s) for queue "${queueName}"`,
            );
        }
    }
}

/**
 * Drop legacy `task` text column when modern `name` is already present.
 * @returns {Promise<string[]>}
 */
async function dropLegacyTaskNameColumn(db, tableNames, { dryRun, log, label }) {
    const actions = [];
    for (const table of tableNames) {
        if (!(await db.tableExists(table).catch(() => false))) continue;
        const hasTask = await db.schema.hasColumn(table, "task");
        const hasName = await db.schema.hasColumn(table, "name");
        if (!hasTask || !hasName) continue;
        const sql = `ALTER TABLE "${table}" DROP COLUMN IF EXISTS "task"`;
        actions.push(sql);
        if (dryRun) {
            log?.info?.(`[tasks-schema] dryRun — ${label}: ${sql}`);
        } else {
            await db.raw(sql);
            log?.info?.(`[tasks-schema] ${label}: dropped legacy column ${table}.task`);
        }
    }
    return actions;
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

    const row = {
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
    };

    // Hybrid DBs may still have legacy NOT NULL "task" until ensureTaskTables drops it.
    if (await tableHasLegacyTaskColumn(db, tasksTable)) {
        row.task = name;
    }

    await db(tasksTable).insert(row);
    return id;
}

/** @type {Map<string, boolean>} */
const legacyTaskColumnCache = new Map();

async function tableHasLegacyTaskColumn(db, tableName) {
    const key = `${db?.config?.name ?? "db"}:${tableName}`;
    if (!legacyTaskColumnCache.has(key)) {
        legacyTaskColumnCache.set(key, await db.schema.hasColumn(tableName, "task"));
    }
    return legacyTaskColumnCache.get(key);
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

/**
 * Progress reporter for one running task: at most one in-flight UPDATE, with
 * the latest value coalesced. Prevents fire-and-forget per-photo writes from
 * saturating the Knex pool under high `maxParallel`.
 *
 * @param {object} context
 * @param {string} tasksTable
 * @param {string} taskId
 * @returns {(progress: unknown) => Promise<void>}
 */
export function createTaskProgressReporter(context, tasksTable, taskId) {
    let pump = null;
    let pending = undefined;
    let hasPending = false;

    return (progress) => {
        pending = progress;
        hasPending = true;
        if (pump) return pump;

        pump = (async () => {
            try {
                while (hasPending) {
                    hasPending = false;
                    const value = pending;
                    try {
                        await updateTaskProgress(context, tasksTable, taskId, value);
                    } catch (err) {
                        context.logger?.warn?.(
                            `[tasks] progress update failed for ${taskId}: ${err?.message ?? err}`
                        );
                    }
                }
            } finally {
                pump = null;
            }
        })();

        return pump;
    };
}

const LEAF_LOG_TASKS = new Set(["loadHarvested", "harvest", "processListingPhotos"]);

function parseTaskParams(raw) {
    if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
    if (typeof raw === "string") {
        try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
        } catch {
            /* ignore */
        }
    }
    return null;
}

/**
 * Top-level task tag for pm2 / console lines (`intakeCycle:bright`).
 * Child rows (`loadHarvested`, harvest) use `params.logTask` or `opid`
 * so they still show the parent, not `loadHarvested:bright/media`.
 *
 * @param {object} [row]
 * @returns {string}
 */
export function loggerTaskLabel(row) {
    const name = String(row?.name || "task").trim() || "task";
    const params = parseTaskParams(row?.params);
    const explicit = params?.logTask != null ? String(params.logTask).trim() : "";
    if (explicit) return explicit;
    if (LEAF_LOG_TASKS.has(name)) {
        const fromOpid = logTaskFromOpid(row?.opid);
        if (fromOpid) return fromOpid;
    }
    const source = params?.source != null ? String(params.source).trim() : "";
    if (source) return `${name}:${source}`;
    return name;
}

/**
 * @param {unknown} opid
 * @returns {string|null}
 */
export function logTaskFromOpid(opid) {
    const s = String(opid ?? "").trim();
    const intake = s.match(/^intake:([^:]+)/);
    if (intake) return `intakeCycle:${intake[1]}`;
    return null;
}
