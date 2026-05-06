#!/usr/bin/env node

import { init } from "../../src/init/index.js";
import { dbInit } from "../../src/db/index.js";
import { enqueueTask, ensureTaskTables, waitForTaskResult } from "../../src/tasks/index.js";

const defs = {
    dbName: "string default local",
    table: "string default tasks",
    target: "string default localRunner",
    waitMs: "number default 15000",
};

const flow = async (context) => {
    const { dbName, table, target, waitMs } = context.params.getAll(defs);
    const db = await dbInit(context, dbName);
    context.db = db;

    await ensureTaskTables(context, { queue: table, recreate: false });
    const id = await enqueueTask(context, {
        queue: table,
        target,
        task: "ping",
        priority: 100,
        params: { from: "test-task-ping.ts" },
    });
    context.logger.info?.(`[test-task-ping] enqueued id=${id}`);

    const done = await waitForTaskResult(context, id, { queue: table, timeoutMs: waitMs });
    if (!done) {
        context.logger.warn?.(`[test-task-ping] timeout after ${waitMs}ms`);
        return;
    }
    context.logger.info?.(
        `[test-task-ping] done success=${done.success} results=${JSON.stringify(done.results)}`
    );
};

void init(flow);
