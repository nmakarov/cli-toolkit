#!/usr/bin/env node

import { init } from "../../src/init/index.js";
import { dbInit } from "../../src/db/index.js";
import { enqueueTask, ensureTaskTables, queueToTableNames } from "../../src/tasks/index.js";
import { timeMatcher } from "../../src/tasks/time-matcher.js";

// Ensure recurring dummyHarvest tasks for all source/resource pairs.
// npx tsx examples/tasks/ensure-dummy-harvest.ts --dbName=local --table=tasks --target=localRunner --schedule="*/10" --pause=false

const SOURCES = ["armls", "noris", "gamls", "iresds"];
const RESOURCES = ["offices", "members", "properties"];

const defs = {
    dbName: "string default local",
    table: "string default tasks",
    target: "string default localRunner",
    schedule: "string default */10",
    pause: "boolean default false",
    priority: "number default 100",
    minRecords: "number default 50",
    maxRecords: "number default 500",
    delayMs: "number default 200",
    batchSize: "number default 25",
    loadDelayMs: "number default 150",
    harvestErrorChance: "number default 0",
    loadErrorChance: "number default 0",
};
const LOCKED_BY_ERROR_MESSAGE = "locked by error";

function normalizeSchedule(raw: string): string {
    const schedule = (raw || "").trim();
    if (!schedule) {
        throw new Error(`--schedule is required`);
    }

    // Shortcut format: "*/10" => "*/10 * * * * *"
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
    paused_at: Date | string | null;
    progress: string | null;
};

async function ensurePairTask(
    context: any,
    tasksTable: string,
    opts: {
        target: string;
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
        queue: string;
    }
): Promise<"created" | "updated"> {
    const db = context.db;
    const existing = await db(tasksTable)
        .select("id", "paused_at", "progress")
        .where({ task: "dummyHarvest", target: opts.target })
        .whereRaw("(params::json->>'source') = ?", [opts.source])
        .whereRaw("(params::json->>'resource') = ?", [opts.resource])
        .orderBy("created_at", "asc")
        .first() as ExistingTask | undefined;

    if (!existing) {
        const id = await enqueueTask(context, {
            queue: opts.queue,
            target: opts.target,
            task: "dummyHarvest",
            schedule: opts.schedule,
            priority: opts.priority,
            params: {
                source: opts.source,
                resource: opts.resource,
                minRecords: opts.minRecords,
                maxRecords: opts.maxRecords,
                delayMs: opts.delayMs,
                batchSize: opts.batchSize,
                loadDelayMs: opts.loadDelayMs,
                harvestErrorChance: opts.harvestErrorChance,
                loadErrorChance: opts.loadErrorChance,
            },
        });
        if (opts.pause) {
            await db(tasksTable).where({ id }).update({
                paused_at: db.fn.now(),
                progress: null,
                past_due: null,
            });
        }
        context.logger.info?.(
            `[ensure-dummy-harvest] created ${opts.source}/${opts.resource} id=${id} schedule="${opts.schedule}" paused=${opts.pause ? "yes" : "no"}`
        );
        return "created";
    }

    const isLockedByError = typeof existing.progress === "string"
        && existing.progress.trim().toLowerCase() === LOCKED_BY_ERROR_MESSAGE;

    const updatePayload: Record<string, any> = {
        schedule: opts.schedule,
        priority: opts.priority,
        params: {
            source: opts.source,
            resource: opts.resource,
            minRecords: opts.minRecords,
            maxRecords: opts.maxRecords,
            delayMs: opts.delayMs,
            batchSize: opts.batchSize,
            loadDelayMs: opts.loadDelayMs,
            harvestErrorChance: opts.harvestErrorChance,
            loadErrorChance: opts.loadErrorChance,
        },
    };
    if (!isLockedByError) {
        updatePayload.paused_at = opts.pause ? db.fn.now() : null;
        updatePayload.progress = null;
        updatePayload.past_due = null;
    }
    await db(tasksTable).where({ id: existing.id }).update(updatePayload);
    context.logger.info?.(
        `[ensure-dummy-harvest] updated ${opts.source}/${opts.resource} id=${existing.id} schedule="${opts.schedule}" paused=${opts.pause ? "yes" : "no"} lockedByErrorPreserved=${isLockedByError ? "yes" : "no"}`
    );
    return "updated";
}

const flow = async (context: any) => {
    const {
        dbName,
        table,
        target,
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

    const db = await dbInit(context, dbName);
    context.db = db;
    await ensureTaskTables(context, { queue: table, recreate: false });
    const { tasksTable } = queueToTableNames(table);
    const schedule = normalizeSchedule(scheduleRaw);

    let created = 0;
    let updated = 0;
    for (const source of SOURCES) {
        for (const resource of RESOURCES) {
            const result = await ensurePairTask(context, tasksTable, {
                queue: table,
                target,
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

    context.logger.info?.(
        `[ensure-dummy-harvest] done target=${target} table=${table} pairs=${SOURCES.length * RESOURCES.length} created=${created} updated=${updated} schedule="${schedule}" paused=${pause ? "yes" : "no"}`
    );
};

void init(flow);
