#!/usr/bin/env node

import { init } from "../../src/init/index.js";
import { dbInit } from "../../src/db/index.js";
import { TasksManager } from "../../src/tasks/index.js";
import { createExampleTasksRegistry } from "./customTasksRegistry.js";

const defs = {
    dbName: "string default local",
    table: "string default tasks",
    target: "string default localRunner",
    allowedTasks: "string",
    role: "string default all",
    dummyLoadMaxParallel: "number default 2",
    dummyPhotosMaxParallel: "number default 5",
    tasksLogsEnabled: "boolean default true",
    tasksLogsBasePath: "string default ./data",
    tasksLogsNamespace: "string default tasks-logs",
    tasksLogsTable: "string default runner",
    tasksErrorLogsTable: "string default runner-errors",
    tasksLogsMaxVersions: "number default 20",
    maxParallel: "number default 8",
    pollMs: "number default 500",
};

function resolveAllowedTasks(roleRaw: string, allowedTasksRaw?: string): string | undefined {
    if (allowedTasksRaw && allowedTasksRaw.trim()) return allowedTasksRaw.trim();
    const role = (roleRaw || "all").toLowerCase();
    if (role === "all") return undefined;
    if (role === "harvest") return "dummyHarvest";
    if (role === "load") return "dummyLoad";
    if (role === "photos") return "dummyPhotos";
    if (role === "ingest") return "dummyHarvest,dummyLoad";
    return undefined;
}

const flow = async (context: any) => {
    const {
        dbName,
        table,
        target,
        allowedTasks,
        role,
        // read to mark as used/show in run config
        dummyLoadMaxParallel,
        dummyPhotosMaxParallel,
        tasksLogsEnabled,
        tasksLogsBasePath,
        tasksLogsNamespace,
        tasksLogsTable,
        tasksErrorLogsTable,
        tasksLogsMaxVersions,
        maxParallel,
        pollMs,
    } = context.params.getAll(defs);
    const db = await dbInit(context, dbName);
    context.db = db;
    const resolvedAllowedTasks = resolveAllowedTasks(role, allowedTasks);

    const tasksManager = TasksManager.init(context, {
        queue: table,
        target,
        allowedTasks: resolvedAllowedTasks,
        maxParallel,
        pollMs,
        registry: createExampleTasksRegistry(),
    });
    context.logger.info?.(
        `[runner] table=${table} target=${target} role=${role} allowedTasks=${resolvedAllowedTasks || "all"} maxParallel=${maxParallel} pollMs=${pollMs} loadMax=${dummyLoadMaxParallel} photosMax=${dummyPhotosMaxParallel} logs=${tasksLogsEnabled ? "on" : "off"} logsPath=${tasksLogsBasePath}/${tasksLogsNamespace}/${tasksLogsTable} errorLogsTable=${tasksErrorLogsTable} logsMaxVersions=${tasksLogsMaxVersions}`
    );
    await tasksManager.ensureTaskTables();
    await tasksManager.runTasksLoop();
};

void init(flow);
