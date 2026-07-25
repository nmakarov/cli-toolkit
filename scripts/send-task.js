#!/usr/bin/env node
/**
 * Enqueue a task row on the queue table (e.g. `tasks`).
 *
 * The script is intentionally thin: it takes `--name`, hands resolution to
 * `TasksRegistry#resolveTaskParams`, and the matching `Task*` class validates
 * its own envelope + custom params (throwing `ParamError` on bad input). The
 * result is shaped for `enqueueTask`, so the script just inserts and (for
 * tasks whose class declares `defaultWaitForResult = true`, e.g. `ping`,
 * `systemInfo`, `taskSumAB`) waits for the history row and prints a report.
 *
 * `--wait` / `--noWait` override the per-task default.
 *
 * @example
 * npx tsx scripts/send-task.js --dbName=local --queueName=tasks --name=ping
 * npx tsx scripts/send-task.js --dbName=local --name=ping --serviceGroup=loader --noWait
 * npx tsx scripts/send-task.js --dbName=local --name=shellCommand --command='echo hi' --wait
 * npx tsx scripts/send-task.js --dbName=local --name=shellCommand --paramsJson='{"command":"echo hi"}' --wait
 * # hot-update maxParallel on every alive photos runner:
 * npx tsx scripts/send-task.js --dbName=everystate --name=setRuntimeParam \
 *   --serviceGroup=photos --paramKey=maxParallel --paramValue=16 --wait
 */

import { init } from "../src/init/index.js";
import { Db } from "../src/db/index.js";
import { enqueueTask, ensureTaskTables, waitForTaskResult } from "../src/tasks/index.js";
import { createExampleTasksRegistry } from "./customTasks/registry.js";

const scriptDefs = {
    /** Override: wait for completion regardless of TaskClass.defaultWaitForResult. */
    wait: "boolean default false",
    /** Override: skip waiting even when TaskClass.defaultWaitForResult is true. */
    noWait: "boolean default false",
    timeoutMs: "number default 120000",
    pollMs: "number default 100",
};

function parseTime(v) {
    if (v == null) return null;
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? null : t;
}

function durationMs(row) {
    const s = parseTime(row.started_at);
    const e = parseTime(row.completed_at);
    if (s == null || e == null) return null;
    return Math.max(0, e - s);
}

function formatResultReport(row) {
    const dur = durationMs(row);
    const executor = {
        service_group: row.service_group ?? null,
        service_name: row.service_name ?? null,
        instance_number: row.instance_number ?? null,
        server_name: row.server_name ?? null,
    };
    const report = {
        taskId: row.id,
        name: row.name,
        status: row.status,
        success: row.success,
        results: row.results,
        executedBy: executor,
        timing: {
            created_at: row.created_at,
            started_at: row.started_at,
            completed_at: row.completed_at,
            duration_ms: dur,
        },
    };
    return JSON.stringify(report, null, 2);
}

const flow = async (context) => {
    const logger = context.logger;
    const { wait, noWait, timeoutMs, pollMs } = context.params.getAll(scriptDefs);

    const db = await Db.init(context);
    context.db = db;

    const registry = createExampleTasksRegistry();
    const nameHint = context.params.get("name", "string");
    const TaskClass = registry.requireClass(
        typeof nameHint === "string" ? nameHint.trim() : nameHint
    );

    const wantWait = noWait === true
        ? false
        : (wait === true || TaskClass.defaultWaitForResult === true);

    // Tasks that know how to expand targeting (e.g. setRuntimeParam broadcast).
    if (typeof TaskClass.enqueue === "function") {
        await ensureTaskTables(context, {
            queueName: context.params.get("queueName", "string") || "tasks",
            recreate: false,
        });
        const { ids, targets } = await TaskClass.enqueue(context, {});
        logger.info?.(
            `[send-task] enqueued ${ids.length} task(s) name=${nameHint} targets=${targets.join(",") || "-"}`
        );
        if (!wantWait) {
            logger.info?.(ids.join(","));
            return;
        }
        let anyFail = false;
        for (const id of ids) {
            const done = await waitForTaskResult(context, id, {
                queueName: context.params.get("queueName", "string") || "tasks",
                timeoutMs: Number(timeoutMs) || 120_000,
                pollMs: Number(pollMs) || 100,
            });
            if (!done) {
                logger.error?.(`send-task: timeout waiting for task ${id}`);
                process.exitCode = 1;
                return;
            }
            logger.info?.(String(id));
            logger.info?.(formatResultReport(done));
            if (done.success === false) anyFail = true;
        }
        if (anyFail) process.exitCode = 1;
        return;
    }

    const payload = await registry.resolveTaskParams(context);

    await ensureTaskTables(context, { queueName: payload.queueName, recreate: false });
    const id = await enqueueTask(context, payload);

    logger.info?.(
        `[send-task] enqueued id=${id} name=${payload.name} queue=${payload.queueName} group=${payload.serviceGroup ?? "-"} serviceName=${payload.serviceName ?? "-"} instance=${payload.instanceNumber ?? "-"} server=${payload.serverName ?? "-"}`
    );

    if (!wantWait) {
        logger.info?.(String(id));
        return;
    }

    const done = await waitForTaskResult(context, id, {
        queueName: payload.queueName,
        timeoutMs: Number(timeoutMs) || 120_000,
        pollMs: Number(pollMs) || 100,
    });

    if (!done) {
        logger.error?.(`send-task: timeout waiting for task ${id} in ${payload.queueName}_history (${timeoutMs}ms)`);
        process.exitCode = 1;
        return;
    }

    logger.info?.(String(id));
    logger.info?.(formatResultReport(done));
    if (done.success === false) {
        process.exitCode = 1;
    }
};

void init(flow);
