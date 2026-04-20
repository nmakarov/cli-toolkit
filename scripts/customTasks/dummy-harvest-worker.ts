#!/usr/bin/env node
/**
 * Child process for {@link TaskDummyHarvest} (`runNodeTaskScript`) or standalone.
 *
 * Standalone: `npx tsx scripts/customTasks/dummy-harvest-worker.ts --source=armls --resource=properties`
 * Optional row updates: `--syncTaskRow --taskId=<uuid> --dbName=local --queueName=tasks`
 */
import { randomUUID } from "node:crypto";
import { init } from "../../src/init/index.js";
import { dbInit } from "../../src/db/index.js";
import { updateTaskProgress } from "../../src/tasks/taskUtils.js";
import { sleepMs } from "../../src/utils/index.js";

const defs = {
    dbName: "string default local",
    queueName: "string default tasks",
    source: "string required",
    resource: "string required",
    minRecords: "number default 50",
    maxRecords: "number default 500",
    delayMs: "number default 200",
    batchSize: "number default 25",
    harvestErrorChance: "number default 0",
    opid: "string",
    syncTaskRow: "boolean default false",
    taskId: "string",
};

function randomIntInclusive(min: number, max: number): number {
    const lo = Math.ceil(Math.min(min, max));
    const hi = Math.floor(Math.max(min, max));
    return Math.floor(lo + Math.random() * (hi - lo + 1));
}

function sendWorkerResult(payload: Record<string, unknown>): void {
    if (typeof process.send === "function") {
        process.send({ __taskWorkerResult: payload });
    }
}

const flow = async (context: any) => {
    const logger = context.logger;
    const {
        dbName,
        queueName,
        source,
        resource,
        minRecords,
        maxRecords,
        delayMs,
        batchSize,
        harvestErrorChance,
        opid: opidParam,
        syncTaskRow,
        taskId: taskIdParam,
    } = context.params.getAll(defs);

    const opid = opidParam?.trim() || `op_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const taskId = (taskIdParam?.trim() || process.env.TASK_ID || "").trim();

    const minR = Math.max(1, Number(minRecords) || 50);
    const maxR = Math.max(minR, Number(maxRecords) || 500);
    const delay = Math.max(0, Number(delayMs) || 200);
    const batch = Math.max(1, Number(batchSize) || 25);
    const errChance = Math.min(1, Math.max(0, Number(harvestErrorChance) || 0));

    if (syncTaskRow && taskId) {
        const db = await dbInit(context, dbName);
        context.db = db;
        context.tasksQueueName = queueName;
    }

    if (Math.random() < errChance) {
        const msg = "Simulated harvest error (harvestErrorChance)";
        logger.error?.(msg);
        sendWorkerResult({ error: msg, opid });
        process.exitCode = 1;
        return;
    }

    const idPart = taskId ? ` taskId=${taskId}` : "";
    logger.debug?.(
        `[dummy-harvest-worker] started${idPart} source=${source} resource=${resource} opid=${opid}`
    );

    const total = randomIntInclusive(minR, maxR);
    const listingId = `lst_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const photoUrls: string[] = [`https://example.com/photo/${source}/${resource}/1.jpg`];

    for (let i = 0; i < total; i += batch) {
        const done = Math.min(i + batch, total);
        logger.progress("fetch", { prefix: `${source}/${resource}`, count: done, total });
        if (syncTaskRow && taskId && context.db) {
            await updateTaskProgress(context, queueName, taskId, `harvest ${done}/${total}`);
        }
        await sleepMs(delay);
    }

    logger.debug?.(
        `[dummy-harvest-worker] finished${idPart} source=${source} resource=${resource} successfullyFetched=${total} opid=${opid}`
    );

    sendWorkerResult({
        fetched: total,
        listingId,
        photoUrls,
        opid,
    });
};

void init(flow);
