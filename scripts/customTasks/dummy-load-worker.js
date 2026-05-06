#!/usr/bin/env node
/**
 * Child process for `TaskDummyLoad` or standalone (same pattern as dummy-harvest-worker).
 */
import { randomUUID } from "node:crypto";
import { init } from "../../src/init/index.js";
import { Db } from "../../src/db/index.js";
import { updateTaskProgress } from "../../src/tasks/taskUtils.js";
import { sleepMs } from "../../src/utils/index.js";

const defs = {
    queueName: "string default tasks",
    source: "string required",
    resource: "string required",
    recordsCount: "number default 100",
    loadDelayMs: "number default 150",
    batchSize: "number default 25",
    loadErrorChance: "number default 0",
    opid: "string",
    syncTaskRow: "boolean default false",
    taskId: "string",
};

function sendWorkerResult(payload) {
    if (typeof process.send === "function") {
        process.send({ __taskWorkerResult: payload });
    }
}

const flow = async (context) => {
    const logger = context.logger;
    const {
        queueName,
        source,
        resource,
        recordsCount,
        loadDelayMs,
        batchSize,
        loadErrorChance,
        opid: opidParam,
        syncTaskRow,
        taskId: taskIdParam,
    } = context.params.getAll(defs);

    const opid = opidParam?.trim() || "";
    const taskId = (taskIdParam?.trim() || process.env.TASK_ID || "").trim();

    const total = Math.max(1, Math.floor(Number(recordsCount) || 100));
    const delay = Math.max(0, Number(loadDelayMs) || 150);
    const batch = Math.max(1, Number(batchSize) || 25);
    const errChance = Math.min(1, Math.max(0, Number(loadErrorChance) || 0));

    if (syncTaskRow && taskId) {
        const db = await Db.init(context);
        context.db = db;
        context.tasksQueueName = queueName;
    }

    if (Math.random() < errChance) {
        const msg = "Simulated load error (loadErrorChance)";
        logger.error?.(msg);
        sendWorkerResult({ error: msg, opid });
        process.exitCode = 1;
        return;
    }

    for (let i = 0; i < total; i += batch) {
        const done = Math.min(i + batch, total);
        logger.progress("load", { prefix: `${source}/${resource}`, count: done, total });
        if (syncTaskRow && taskId && context.db) {
            await updateTaskProgress(context, queueName, taskId, `load ${done}/${total}`);
        }
        await sleepMs(delay);
    }

    sendWorkerResult({
        loaded: total,
        opid,
        batchId: `batch_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    });
};

void init(flow);
