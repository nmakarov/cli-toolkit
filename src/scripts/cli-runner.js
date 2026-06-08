#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";
import { init } from "../init/index.js";
import { Db } from "../db/index.js";
import { defaultTasksRegistry, TasksManager, TasksRegistry } from "../tasks/index.js";

// node subprojects/cli-toolkit/src/scripts/cli-runner.js --dbName=local --table=tasks --target=localRunner --recreateTaskTables=true
// node subprojects/cli-toolkit/src/scripts/cli-runner.js --dbName=local --table=tasks --target=localRunner --recreateTaskTables=true --pollMs=1000 --maxParallel=1 --scanLimit=100 --tasksModule=./tasks/index.js

const defs = {
    tasksModule: "string",
};

async function loadTasksModule(modulePath) {
    const absolute = path.isAbsolute(modulePath) ? modulePath : path.resolve(process.cwd(), modulePath);
    const imported = await import(pathToFileURL(absolute).href);
    if (!imported.tasksRegistry || typeof imported.tasksRegistry !== "object") {
        throw new Error(`tasksModule "${modulePath}" must export "tasksRegistry" object`);
    }
    return imported.tasksRegistry ;
}

const flow = async (context) => {
    const { tasksModule } = context.params.getAll(defs);

    const db = await Db.init(context);
    context.db = db;

    const registry = new TasksRegistry().addMany(defaultTasksRegistry.toObject());
    if (tasksModule) {
        const externalRegistry = await loadTasksModule(tasksModule);
        registry.addMany(externalRegistry);
    }

    const tasksManager = TasksManager.init(context, {
        registry,
    });
    await tasksManager.ensureTaskTables();
    await tasksManager.runTasksLoop();
};

void init(flow);
