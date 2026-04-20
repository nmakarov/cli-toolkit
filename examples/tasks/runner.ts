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
    /** Service group for `{table}_services_registry` (discovery / max instances). Empty + role=all disables. */
    runnerServiceGroup: "string",
    runnerServiceName: "string",
    runnerHeartbeatIntervalMs: "number default 10000",
    runnerHeartbeatStaleMs: "number default 45000",
    runnerGroupMaxInstances: "number",
    runnerEnforceMaxInstances: "boolean default true",
};

function defaultRunnerGroupFromRole(roleRaw: string): string {
    const r = (roleRaw || "all").toLowerCase();
    if (r === "all") return "";
    const map: Record<string, string> = {
        harvest: "harvest",
        load: "loader",
        photos: "photos",
        ingest: "ingest",
    };
    return map[r] || "";
}

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
        runnerServiceGroup,
        runnerServiceName,
        runnerHeartbeatIntervalMs,
        runnerHeartbeatStaleMs,
        runnerGroupMaxInstances,
        runnerEnforceMaxInstances,
    } = context.params.getAll(defs);
    const db = await dbInit(context, dbName);
    context.db = db;
    const resolvedAllowedTasks = resolveAllowedTasks(role, allowedTasks);
    const resolvedRunnerGroup =
        (typeof runnerServiceGroup === "string" && runnerServiceGroup.trim()) || defaultRunnerGroupFromRole(role);

    const tasksManager = TasksManager.init(context, {
        queueName: table,
        target,
        allowedTasks: resolvedAllowedTasks,
        maxParallel,
        pollMs,
        registry: createExampleTasksRegistry(),
        ...(resolvedRunnerGroup
            ? {
                  runnerServiceGroup: resolvedRunnerGroup,
                  runnerServiceName: typeof runnerServiceName === "string" && runnerServiceName.trim() ? runnerServiceName.trim() : undefined,
                  runnerHeartbeatIntervalMs,
                  runnerHeartbeatStaleMs,
                  runnerGroupMaxInstances,
                  runnerEnforceMaxInstances,
              }
            : {}),
    });
    context.logger.info?.(
        `[runner] table=${table} target=${target} role=${role} allowedTasks=${resolvedAllowedTasks || "all"} maxParallel=${maxParallel} pollMs=${pollMs} loadMax=${dummyLoadMaxParallel} photosMax=${dummyPhotosMaxParallel} logs=${tasksLogsEnabled ? "on" : "off"} logsPath=${tasksLogsBasePath}/${tasksLogsNamespace}/${tasksLogsTable} errorLogsTable=${tasksErrorLogsTable} logsMaxVersions=${tasksLogsMaxVersions} servicesRegistry=${resolvedRunnerGroup ? `group=${resolvedRunnerGroup}` : "off"}`
    );
    await tasksManager.ensureTaskTables();
    await tasksManager.runTasksLoop();
};

void init(flow);
