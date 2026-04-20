#!/usr/bin/env node
/**
 * Enqueue a task row on the queue table (e.g. `tasks`).
 * Lives under `subprojects/cli-toolkit/scripts/` with `tasks-worker.ts` and `tasks-monitor.ts`.
 *
 * For **`ping`**, by default waits for completion and prints a result summary (use `--noWait` to only print task id).
 * For other tasks, pass **`--wait`** to block until the row appears in `*_history`.
 *
 * @example
 * npx tsx scripts/send-task.ts --dbName=local --queueName=tasks --name=ping
 * npx tsx scripts/send-task.ts --dbName=local --name=ping --serviceGroup=loader --noWait
 * npx tsx scripts/send-task.ts --dbName=local --name=shellCommand --paramsJson='{"command":"echo hi"}' --wait
 */

import { init } from "../src/init/index.js";
import { dbInit } from "../src/db/index.js";
import { enqueueTask, ensureTaskTables, waitForTaskResult } from "../src/tasks/index.js";
import type { TaskRow } from "../src/tasks/types.js";

const defs = {
    dbName: "string default local",
    queueName: "string default tasks",
    name: "string",
    paramsJson: "string",
    serviceGroup: "string",
    serviceName: "string",
    instanceNumber: "number",
    serverName: "string",
    allowanceMs: "number default 5000",
    priority: "number default 50",
    /** Wait for task to finish (always for ping unless --noWait). */
    wait: "boolean default false",
    /** Skip waiting even for ping. */
    noWait: "boolean default false",
    timeoutMs: "number default 120000",
    pollMs: "number default 100",
};

function emptyToUndef(s: unknown): string | undefined {
    if (s === undefined || s === null) return undefined;
    const t = String(s).trim();
    return t.length ? t : undefined;
}

function isStopName(name: string): boolean {
    const n = name.trim().toLowerCase();
    return n === "stop" || n === "stoprunner";
}

function isPingName(name: string): boolean {
    return name.trim().toLowerCase() === "ping";
}

function parseTime(v: Date | string | null | undefined): number | null {
    if (v == null) return null;
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? null : t;
}

function durationMs(row: TaskRow): number | null {
    const s = parseTime(row.started_at);
    const e = parseTime(row.completed_at);
    if (s == null || e == null) return null;
    return Math.max(0, e - s);
}

function formatResultReport(row: TaskRow): string {
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

const flow = async (context: any) => {
    const logger = context.logger;
    const p = context.params.getAll(defs);
    const {
        dbName,
        queueName,
        name: nameRaw,
        paramsJson,
        allowanceMs,
        priority,
        timeoutMs,
        pollMs,
    } = p;

    const name = emptyToUndef(nameRaw);
    if (!name) {
        throw new Error("send-task: --name is required (e.g. ping, stop)");
    }

    const serviceGroup = emptyToUndef(p.serviceGroup);
    const serviceName = emptyToUndef(p.serviceName);
    const serverName = emptyToUndef(p.serverName);
    let instanceNumber: number | undefined = undefined;
    if (p.instanceNumber !== undefined && p.instanceNumber !== null && String(p.instanceNumber).trim() !== "") {
        const n = Number(p.instanceNumber);
        if (!Number.isFinite(n) || n < 1) {
            throw new Error("send-task: --instanceNumber must be a positive integer when set");
        }
        instanceNumber = Math.floor(n);
    }

    if (isStopName(name)) {
        if (!serviceName) {
            throw new Error(
                "send-task: stop/stopRunner requires --serviceName (registry instance name; optional --serviceGroup, --instanceNumber, --serverName to narrow targeting)"
            );
        }
    }

    const wantWait = (isPingName(name) && p.noWait !== true) || p.wait === true;

    let params: Record<string, unknown> | null = null;
    const pj = emptyToUndef(paramsJson);
    if (pj) {
        try {
            const parsed = JSON.parse(pj) as unknown;
            if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
                params = parsed as Record<string, unknown>;
            } else {
                throw new Error("params JSON must be an object");
            }
        } catch (e: any) {
            throw new Error(`send-task: invalid --paramsJson: ${e?.message ?? String(e)}`);
        }
    }

    if (isStopName(name) && params === null) {
        params = { allowanceMs: Number(allowanceMs) || 5000 };
    } else if (isStopName(name) && params !== null && params.allowanceMs === undefined) {
        params.allowanceMs = Number(allowanceMs) || 5000;
    }

    const db = await dbInit(context, dbName);
    context.db = db;

    await ensureTaskTables(context, { queueName, recreate: false });

    const id = await enqueueTask(context, {
        queueName,
        name,
        params,
        priority: Number(priority) || 50,
        serviceGroup: serviceGroup ?? null,
        serviceName: serviceName ?? null,
        instanceNumber: instanceNumber ?? null,
        serverName: serverName ?? null,
    });

    logger.info?.(
        `[send-task] enqueued id=${id} name=${name} queue=${queueName} group=${serviceGroup ?? "-"} serviceName=${serviceName ?? "-"} instance=${instanceNumber ?? "-"} server=${serverName ?? "-"}`
    );

    if (!wantWait) {
        logger.info?.(String(id));
        return;
    }

    const done = await waitForTaskResult(context, id, {
        queueName,
        timeoutMs: Number(timeoutMs) || 120_000,
        pollMs: Number(pollMs) || 100,
    });

    if (!done) {
        logger.error?.(`send-task: timeout waiting for task ${id} in ${queueName}_history (${timeoutMs}ms)`);
        process.exitCode = 1;
        return;
    }

    logger.info?.(String(id));
    logger.info?.(formatResultReport(done as TaskRow));
    if (done.success === false) {
        process.exitCode = 1;
    }
};

void init(flow);
