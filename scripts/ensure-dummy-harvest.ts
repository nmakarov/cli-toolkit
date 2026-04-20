#!/usr/bin/env node
/**
 * Ensure recurring `dummyHarvest` tasks for all source/resource pairs (same grid as the example).
 *
 * All CLI params are optional; defaults come from `defs` below (database, queue, schedule, tuning, etc.).
 *
 * @example Minimal — no flags (everything uses defaults):
 * npx tsx scripts/ensure-dummy-harvest.ts
 *
 * @example Full — same script with common options spelled out (equivalent to defaults unless you change values):
 * npx tsx scripts/ensure-dummy-harvest.ts --dbName=local --queueName=tasks --pause=false --priority=50 --minRecords=50 --maxRecords=500 --delayMs=200 --batchSize=25 --loadDelayMs=150 --harvestErrorChance=0 --loadErrorChance=0
 *
 * @example Remove all dummyHarvest rows for the built-in source/resource grid (positional command):
 * npx tsx scripts/ensure-dummy-harvest.ts delete
 */

import { init } from "../src/init/index.js";
import { dbInit } from "../src/db/index.js";
import { enqueueTask, ensureTaskTables, queueToTableNames } from "../src/tasks/index.js";
import { nextTimeMatch, timeMatcher } from "../src/tasks/time-matcher.js";
import { toJsonColumn } from "../src/utils/index.js";

const SOURCES = ["armls", "noris", "gamls", "iresds"];
const RESOURCES = ["offices", "members", "properties"];

const defs = {
    dbName: "string default local",
    queueName: "string default tasks",
    /** `ensure` (default) upserts rows; `delete` removes matching dummyHarvest rows. Same as positional `ensure` / `delete` unless `--operation` is set explicitly. */
    operation: "string default ensure",
    schedule: "string default */30",
    pause: "boolean default false",
    priority: "number default 50",
    minRecords: "number default 50",
    maxRecords: "number default 500",
    delayMs: "number default 200",
    batchSize: "number default 25",
    loadDelayMs: "number default 150",
    harvestErrorChance: "number default 0",
    loadErrorChance: "number default 0",
};

const LOCKED_BY_ERROR_MESSAGE = "locked by error";

function emptyToUndef(s: unknown): string | undefined {
    if (s === undefined || s === null) return undefined;
    const t = String(s).trim();
    return t.length ? t : undefined;
}

function normalizeOperation(raw: unknown): "ensure" | "delete" {
    const n = (emptyToUndef(raw) ?? "ensure").toLowerCase();
    if (n === "ensure" || n === "delete") return n;
    throw new Error(
        `ensure-dummy-harvest: operation must be "ensure" or "delete" (e.g. \`npx tsx ... delete\` or --operation=delete), got "${raw}"`
    );
}

/** Prefer `--operation` / env / config when explicitly set; otherwise first positional `ensure` or `delete`. */
function resolveOperation(context: any, operationFromDefs: unknown): "ensure" | "delete" {
    const src = context.args.getSource?.("operation");
    if (src === "cli" || src === "overrides" || src === "env" || src === "config") {
        return normalizeOperation(operationFromDefs);
    }
    for (const c of context.args.getCommands()) {
        const lc = String(c).toLowerCase();
        if (lc === "delete" || lc === "ensure") return lc as "ensure" | "delete";
    }
    return normalizeOperation(operationFromDefs);
}

function normalizeSchedule(raw: string): string {
    const schedule = (raw || "").trim();
    if (!schedule) {
        throw new Error(`--schedule is required`);
    }

    const expanded = /^\*\/\d+$/.test(schedule) ? `${schedule} * * * * *` : schedule;
    try {
        timeMatcher(expanded, new Date());
    } catch (error: any) {
        throw new Error(
            `Invalid --schedule="${schedule}". Use either shortcut like "*/10" or full 6-field schedule. ${error.message}`
        );
    }
    return expanded;
}

type ExistingTask = {
    id: string;
    status: string;
    progress: string | null;
};

async function ensurePairTask(
    context: any,
    tasksTable: string,
    opts: {
        source: string;
        resource: string;
        schedule: string;
        pause: boolean;
        priority: number;
        minRecords: number;
        maxRecords: number;
        delayMs: number;
        batchSize: number;
        loadDelayMs: number;
        harvestErrorChance: number;
        loadErrorChance: number;
        queueName: string;
    }
): Promise<"created" | "updated"> {
    const db = context.db;
    const existing = (await db(tasksTable)
        .select("id", "status", "progress")
        .where({ name: "dummyHarvest" })
        .whereRaw("(params::json->>'source') = ?", [opts.source])
        .whereRaw("(params::json->>'resource') = ?", [opts.resource])
        .orderBy("created_at", "asc")
        .first()) as ExistingTask | undefined;

    const paramsObj = {
        source: opts.source,
        resource: opts.resource,
        minRecords: opts.minRecords,
        maxRecords: opts.maxRecords,
        delayMs: opts.delayMs,
        batchSize: opts.batchSize,
        loadDelayMs: opts.loadDelayMs,
        harvestErrorChance: opts.harvestErrorChance,
        loadErrorChance: opts.loadErrorChance,
    };

    if (!existing) {
        const id = await enqueueTask(context, {
            queueName: opts.queueName,
            name: "dummyHarvest",
            schedule: opts.schedule,
            priority: opts.priority,
            params: paramsObj,
        });
        if (opts.pause) {
            await db(tasksTable).where({ id }).update({
                status: "paused",
                status_changed_at: db.fn.now(),
                progress: null,
                past_due: null,
            });
        }
        context.logger.info?.(
            `[ensure-dummy-harvest] created ${opts.source}/${opts.resource} id=${id} schedule="${opts.schedule}" paused=${opts.pause ? "yes" : "no"}`
        );
        return "created";
    }

    const isLockedByError =
        typeof existing.progress === "string" && existing.progress.trim().toLowerCase() === LOCKED_BY_ERROR_MESSAGE;

    const updatePayload: Record<string, any> = {
        schedule: opts.schedule,
        priority: opts.priority,
        params: toJsonColumn(paramsObj),
        service_group: null,
        next_run_at: nextTimeMatch(opts.schedule, new Date()),
    };
    if (!isLockedByError) {
        updatePayload.status = opts.pause ? "paused" : "idle";
        updatePayload.status_changed_at = db.fn.now();
        updatePayload.progress = null;
        updatePayload.past_due = null;
        if (!opts.pause) {
            updatePayload.service_name = null;
            updatePayload.server_name = null;
            updatePayload.instance_number = null;
        }
    }
    await db(tasksTable).where({ id: existing.id }).update(updatePayload);
    context.logger.info?.(
        `[ensure-dummy-harvest] updated ${opts.source}/${opts.resource} id=${existing.id} schedule="${opts.schedule}" paused=${opts.pause ? "yes" : "no"} lockedByErrorPreserved=${isLockedByError ? "yes" : "no"}`
    );
    return "updated";
}

async function deletePairTask(
    context: any,
    tasksTable: string,
    source: string,
    resource: string
): Promise<number> {
    const db = context.db;
    const n = await db(tasksTable)
        .where({ name: "dummyHarvest" })
        .whereRaw("(params::json->>'source') = ?", [source])
        .whereRaw("(params::json->>'resource') = ?", [resource])
        .delete();
    return typeof n === "number" ? n : 0;
}

const flow = async (context: any) => {
    const logger = context.logger;
    const {
        dbName,
        queueName,
        operation: operationRaw,
        schedule: scheduleRaw,
        pause,
        priority,
        minRecords,
        maxRecords,
        delayMs,
        batchSize,
        loadDelayMs,
        harvestErrorChance,
        loadErrorChance,
    } = context.params.getAll(defs);

    const operation = resolveOperation(context, operationRaw);

    const db = await dbInit(context, dbName);
    context.db = db;
    await ensureTaskTables(context, { queueName, recreate: false });
    const { tasksTable } = queueToTableNames(queueName);

    if (operation === "delete") {
        let removed = 0;
        for (const source of SOURCES) {
            for (const resource of RESOURCES) {
                const n = await deletePairTask(context, tasksTable, source, resource);
                removed += n;
                logger.info?.(`[ensure-dummy-harvest] delete ${source}/${resource} removed=${n}`);
            }
        }
        logger.info?.(
            `[ensure-dummy-harvest] done operation=delete queue=${queueName} pairs=${SOURCES.length * RESOURCES.length} rowsRemoved=${removed}`
        );
        return;
    }

    const schedule = normalizeSchedule(scheduleRaw);

    let created = 0;
    let updated = 0;
    for (const source of SOURCES) {
        for (const resource of RESOURCES) {
            const result = await ensurePairTask(context, tasksTable, {
                queueName,
                source,
                resource,
                schedule,
                pause,
                priority,
                minRecords,
                maxRecords,
                delayMs,
                batchSize,
                loadDelayMs,
                harvestErrorChance,
                loadErrorChance,
            });
            if (result === "created") created += 1;
            else updated += 1;
        }
    }

    logger.info?.(
        `[ensure-dummy-harvest] done operation=ensure queue=${queueName} pairs=${SOURCES.length * RESOURCES.length} created=${created} updated=${updated} schedule="${schedule}" paused=${pause ? "yes" : "no"}`
    );
};

void init(flow);
