#!/usr/bin/env node

import { init } from "../../src/init/index.js";
import { dbInit } from "../../src/db/index.js";
import { enqueueTask, ensureTaskTables, waitForTaskResult } from "../../src/tasks/index.js";

// npx tsx examples/tasks/workflow-prototype.ts --source=armls --resource=properties --wait=true

const defs = {
    dbName: "string default local",
    table: "string default tasks",
    target: "string default localRunner",
    source: "string required",
    resource: "string required",
    minRecords: "number default 50",
    maxRecords: "number default 500",
    delayMs: "number default 200",
    batchSize: "number default 25",
    priority: "number default 100",
    wait: "boolean default true",
    waitMs: "number default 90000",
    maxDepth: "number default 8",
};

const flow = async (context) => {
    const {
        dbName,
        table,
        target,
        source,
        resource,
        minRecords,
        maxRecords,
        delayMs,
        batchSize,
        priority,
        wait,
        waitMs,
        maxDepth,
    } = context.params.getAll(defs);

    const db = await dbInit(context, dbName);
    context.db = db;
    await ensureTaskTables(context, { queue: table, recreate: false });

    const rootId = await enqueueTask(context, {
        queue: table,
        target,
        task: "dummyHarvest",
        priority,
        params: { source, resource, minRecords, maxRecords, delayMs, batchSize },
    });
    context.logger.info?.(
        `[workflow-prototype] queued root task id=${rootId} source=${source} resource=${resource} target=${target}`
    );
    if (!wait) return;

    const chain = [];
    let currentId = rootId;
    let depth = 0;
    while (currentId && depth < maxDepth) {
        depth += 1;
        const done = await waitForTaskResult(context, currentId, { queue: table, timeoutMs: waitMs });
        if (!done) {
            context.logger.warn?.(`[workflow-prototype] timeout waiting for id=${currentId} depth=${depth}`);
            break;
        }
        chain.push({
            id: done.id,
            task: done.task,
            success: !!done.success,
            opid: (done ).opid ?? done.results?.opid ?? null,
        });

        const nextTaskId = done.results?.nextTaskId;
        if (typeof nextTaskId === "string" && nextTaskId.trim()) {
            currentId = nextTaskId.trim();
            continue;
        }
        currentId = null;
    }

    context.logger.info?.(`[workflow-prototype] chain length=${chain.length}`);
    for (const step of chain) {
        context.logger.info?.(
            `[workflow-prototype] step task=${step.task} id=${step.id} success=${step.success} opid=${step.opid || "none"}`
        );
    }
};

void init(flow);
