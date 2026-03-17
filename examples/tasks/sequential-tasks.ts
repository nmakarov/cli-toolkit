#!/usr/bin/env node

import { init } from "../../src/init/index.js";
import { dbInit } from "../../src/db/index.js";
import { enqueueTask, ensureTaskTables, TasksManager, waitForTaskResult } from "../../src/tasks/index.js";
import { createExampleTasksRegistry } from "./customTasksRegistry.js";

// Create harvest task:
// npx tsx examples/tasks/sequential-tasks.ts create --source=mls --resource=property --minRecords=50 --maxRecords=500 --delayMs=200 --batchSize=25 --wait=true
// Run queue worker with custom tasks:
// npx tsx examples/tasks/sequential-tasks.ts run --target=localRunner

const defs = {
    dbName: "string default local",
    table: "string default tasks",
    target: "string default localRunner",
    allowedTasks: "string",
    source: "string",
    resource: "string",
    minRecords: "number default 50",
    maxRecords: "number default 500",
    delayMs: "number default 200",
    batchSize: "number default 25",
    priority: "number default 100",
    wait: "boolean default false",
    waitMs: "number default 30000",
};

const flow = async (context: any) => {
    const {
        dbName,
        table,
        target,
        allowedTasks,
        source,
        resource,
        minRecords,
        maxRecords,
        delayMs,
        batchSize,
        priority,
        wait,
        waitMs,
    } = context.params.getAll(defs);

    const db = await dbInit(context, dbName);
    context.db = db;

    const commands = (context.args.getCommands?.() || []) as string[];
    const operation = (commands[0] || "create").toLowerCase();
    const registry = createExampleTasksRegistry();

    if (operation === "run") {
        const tasksManager = TasksManager.init(context, {
            queue: table,
            target,
            allowedTasks,
            registry,
        });
        await tasksManager.ensureTaskTables();
        context.logger.info?.(
            `[sequential-tasks] starting runner for table=${table} target=${target}; supportedTasks=${registry.listSupportedTasks().join(", ")}`
        );
        await tasksManager.runTasksLoop();
        return;
    }

    if (operation !== "create") {
        throw new Error(`Unknown command "${operation}". Use "create" or "run".`);
    }

    if (!source || !resource) {
        throw new Error(`--source and --resource are required for operation=create`);
    }

    await ensureTaskTables(context, { queue: table, recreate: false });
    const harvestTaskId = await enqueueTask(context, {
        queue: table,
        target,
        task: "dummyHarvest",
        priority,
        params: {
            source,
            resource,
            minRecords,
            maxRecords,
            delayMs,
            batchSize,
        },
    });
    context.logger.info?.(
        `[sequential-tasks] enqueued dummyHarvest id=${harvestTaskId} source=${source} resource=${resource} target=${target}`
    );

    if (!wait) return;

    const harvestDone = await waitForTaskResult(context, harvestTaskId, { queue: table, timeoutMs: waitMs });
    if (!harvestDone) {
        context.logger.warn?.(`[sequential-tasks] timeout waiting for harvest id=${harvestTaskId}`);
        return;
    }

    context.logger.info?.(
        `[sequential-tasks] harvest done success=${harvestDone.success} results=${JSON.stringify(harvestDone.results)}`
    );
    const nextTaskId = harvestDone?.results?.nextTaskId;
    if (typeof nextTaskId !== "string" || !nextTaskId) return;

    const loadDone = await waitForTaskResult(context, nextTaskId, { queue: table, timeoutMs: waitMs });
    if (!loadDone) {
        context.logger.warn?.(`[sequential-tasks] timeout waiting for load id=${nextTaskId}`);
        return;
    }
    context.logger.info?.(
        `[sequential-tasks] load done success=${loadDone.success} results=${JSON.stringify(loadDone.results)}`
    );
};

void init(flow);
