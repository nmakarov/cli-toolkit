#!/usr/bin/env npx tsx
/**
 * Minimal **tasks worker** (long-lived process): connects to the DB, ensures task tables,
 * registers in `{queueName}_services_registry`, runs the polling / claim / execute loop, and
 * unregisters on shutdown (also defensively via `registerCleanup`).
 *
 * **Allowlist**
 * - Pass **`--allowedTasks=...`** (comma-separated) for an explicit list; it is merged with
 *   built-in *service* tasks ({@link SERVICE_TASK_NAMES}: ping, stop, shellCommand, …).
 * - Or omit `--allowedTasks` and use **`scripts/tasks-service-groups.json`** (override path with
 *   `--tasksByServiceGroupConfig`): top-level keys are service group names; each value has
 *   `"tasks": ["taskName", ...]` and optional `"maxInstances": N` for that group (0 = unlimited in
 *   `{queue}_services_registry`). The worker loads the entry for `--serviceGroup`.
 *
 * @example
 * npx tsx scripts/tasks-worker.ts --dbName=local --serviceGroup=harvest --queueName=tasks
 * npx tsx scripts/tasks-worker.ts --dbName=local --serviceGroup=loader --allowedTasks=dummyLoad
 */

import { existsSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { init } from "../src/init/index.js";
import { dbInit } from "../src/db/index.js";
import {
    ensureTaskTables,
    runTasksLoop,
    SERVICE_TASK_NAMES,
    mergeAllowedTasksWithServiceTasks,
    normalizeAllowedTasks,
    unregisterServicesRegistry,
} from "../src/tasks/index.js";
import type { ServicesRegistryRegistration } from "../src/tasks/servicesRegistry.js";
import { createExampleTasksRegistry } from "./customTasks/registry.js";
import { loadServiceGroupEntryFromFile } from "./loadTasksServiceGroups.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultTasksByServiceGroupConfig = join(__dirname, "tasks-service-groups.json");

const defs = {
    dbName: "string default local",
    /** When true, `ensureTaskTables` drops queue + _history + _services_registry for `queueName`, then recreates. */
    recreateTaskTables: "boolean default false",
    queueName: "string default tasks",
    /** Which `service_group` rows this worker claims (must match enqueued tasks). */
    serviceGroup: "string",
    pollMs: "number default 200",
    /** Random 0..N ms once per poll cycle before claiming work tasks; spreads load across multiple workers (default 500). */
    claimJitterMs: "number default 500",
    runnerHeartbeatIntervalMs: "number default 10000",
    runnerHeartbeatStaleMs: "number default 45000",
    /** Comma-separated task names. If omitted, `tasksByServiceGroupConfig` is used for this `serviceGroup`. */
    allowedTasks: "string",
    /** JSON file: `{ "<serviceGroup>": { "tasks": [...], "maxInstances": N } }`. Default: `scripts/tasks-service-groups.json` beside this script. */
    tasksByServiceGroupConfig: "string",
    /** Overrides `maxInstances` from the JSON file for this service group (non-negative integer; 0 = unlimited). */
    runnerGroupMaxInstances: "number",
    maxParallel: "number default 32",
    scanLimit: "number default 50",
};

const flow = async (context: any) => {
    const {
        dbName,
        recreateTaskTables,
        queueName,
        serviceGroup,
        pollMs,
        claimJitterMs,
        runnerHeartbeatIntervalMs,
        runnerHeartbeatStaleMs,
        allowedTasks: allowedTasksRaw,
        tasksByServiceGroupConfig: tasksByServiceGroupConfigRaw,
        runnerGroupMaxInstances: runnerGroupMaxInstancesRaw,
        maxParallel,
        scanLimit,
    } = context.params.getAll(defs);

    if (!serviceGroup?.trim()) {
        throw new Error("tasks-worker: --serviceGroup is required (e.g. loader, harvest, photos)");
    }
    const sg = serviceGroup.trim();

    const explicit = normalizeAllowedTasks(allowedTasksRaw);
    const configPath = (tasksByServiceGroupConfigRaw ?? "").trim() || defaultTasksByServiceGroupConfig;

    let resolvedAllowed: string[];
    let runnerGroupMaxInstances: number | undefined;

    const cliMax = ((): number | undefined => {
        if (runnerGroupMaxInstancesRaw === undefined || runnerGroupMaxInstancesRaw === null) {
            return undefined;
        }
        if (typeof runnerGroupMaxInstancesRaw === "string" && runnerGroupMaxInstancesRaw.trim() === "") {
            return undefined;
        }
        const n = Math.floor(Number(runnerGroupMaxInstancesRaw));
        if (!Number.isFinite(n) || n < 0) {
            return undefined;
        }
        return n;
    })();

    if (explicit?.length) {
        resolvedAllowed = mergeAllowedTasksWithServiceTasks(explicit);
        if (cliMax !== undefined) {
            runnerGroupMaxInstances = cliMax;
        } else if (existsSync(configPath)) {
            try {
                const { maxInstances } = loadServiceGroupEntryFromFile(configPath, sg);
                if (maxInstances !== undefined) {
                    runnerGroupMaxInstances = maxInstances;
                }
            } catch {
                /* ignore missing group in file when using explicit tasks */
            }
        }
    } else {
        if (!existsSync(configPath)) {
            throw new Error(
                `tasks-worker: pass --allowedTasks=... or create "${configPath}" with a "${sg}" entry (see default tasks-service-groups.json)`
            );
        }
        const fromFile = loadServiceGroupEntryFromFile(configPath, sg);
        resolvedAllowed = mergeAllowedTasksWithServiceTasks(fromFile.tasks);
        if (cliMax !== undefined) {
            runnerGroupMaxInstances = cliMax;
        } else if (fromFile.maxInstances !== undefined) {
            runnerGroupMaxInstances = fromFile.maxInstances;
        }
    }

    const db = await dbInit(context, dbName);
    context.db = db;

    context.logger.info?.(
        `[tasks-worker] host=${os.hostname()} queue=${queueName} serviceGroup=${sg} db=${dbName} allowedTasks=[${resolvedAllowed.join(", ")}] serviceDefaults=[${SERVICE_TASK_NAMES.join(", ")}] maxInstances=${runnerGroupMaxInstances ?? "default"}`
    );

    await ensureTaskTables(context, { queueName, recreate: !!recreateTaskTables });

    context.registerCleanup(async (ctx) => {
        const reg = (ctx as any).servicesRegistry as ServicesRegistryRegistration | undefined;
        if (reg?.rowId) {
            await unregisterServicesRegistry(ctx, reg).catch(() => {});
        }
    });

    await runTasksLoop(context, {
        queueName,
        target: sg,
        pollMs,
        claimJitterMs,
        maxParallel,
        scanLimit,
        registry: createExampleTasksRegistry(),
        allowedTasks: resolvedAllowed,
        runnerServiceGroup: sg,
        runnerHeartbeatIntervalMs,
        runnerHeartbeatStaleMs,
        runnerGroupMaxInstances,
    });
};

init(flow).catch((e) => {
    console.error(e);
    process.exit(1);
});
