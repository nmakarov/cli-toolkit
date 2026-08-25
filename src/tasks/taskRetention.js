/**
 * Unified retention for `*_history` rows and IPC FileDatabase logs.
 *
 * The same cutoff is applied to both stores so Inspect history and `l` logs stay
 * aligned. FileDatabase `maxVersions` remains a process-restart backstop only.
 *
 * Config (CLI / env / getAllForModule, then hot-update via setRuntimeParam):
 *   tasksRetentionEnabled        default true
 *   tasksRetentionDays           default 7 (0 = disable time prune)
 *   tasksRetentionIntervalMs     default 1h between automatic passes
 *   tasksRetentionMinFreeRatio   default 0.10 — shrink the window if free/total is below this
 *   tasksRetentionMinHours       default 6 — floor when disk is tight
 */

import { getDiskUsage } from "../utils/os-utils.js";
import { queueToTableNames } from "./taskUtils.js";
import { ensureTasksRuntime } from "./runtimeParams.js";
import { pruneIpcLogsOlderThan, tasksLogsRoot } from "./taskLogs.js";

export const DEFAULT_RETENTION_DAYS = 7;
export const DEFAULT_RETENTION_INTERVAL_MS = 60 * 60 * 1000;
export const DEFAULT_MIN_FREE_RATIO = 0.1;
export const DEFAULT_MIN_RETENTION_HOURS = 6;
export const HISTORY_PRUNE_CHUNK = 2000;

const RETENTION_PARAM_DEFS = {
    tasksRetentionEnabled: "boolean default true",
    tasksRetentionDays: "number default 7",
    tasksRetentionIntervalMs: "number default 3600000",
    tasksRetentionMinFreeRatio: "number default 0.1",
    tasksRetentionMinHours: "number default 6",
};

/**
 * Register CLI/env knobs and seed `context.tasksRuntime` once per process.
 *
 * @param {object} context
 * @returns {Record<string, unknown>}
 */
export function seedTaskRetentionRuntime(context) {
    const fromParams =
        typeof context.params?.getAllForModule === "function"
            ? context.params.getAllForModule("tasks-retention", RETENTION_PARAM_DEFS)
            : {};
    const rt = ensureTasksRuntime(context);
    if (rt.tasksRetentionEnabled === undefined) {
        rt.tasksRetentionEnabled = fromParams.tasksRetentionEnabled !== false;
    }
    if (rt.tasksRetentionDays === undefined) {
        rt.tasksRetentionDays = Number(fromParams.tasksRetentionDays ?? DEFAULT_RETENTION_DAYS);
    }
    if (rt.tasksRetentionIntervalMs === undefined) {
        rt.tasksRetentionIntervalMs = Number(
            fromParams.tasksRetentionIntervalMs ?? DEFAULT_RETENTION_INTERVAL_MS,
        );
    }
    if (rt.tasksRetentionMinFreeRatio === undefined) {
        rt.tasksRetentionMinFreeRatio = Number(
            fromParams.tasksRetentionMinFreeRatio ?? DEFAULT_MIN_FREE_RATIO,
        );
    }
    if (rt.tasksRetentionMinHours === undefined) {
        rt.tasksRetentionMinHours = Number(fromParams.tasksRetentionMinHours ?? DEFAULT_MIN_RETENTION_HOURS);
    }
    return rt;
}

/**
 * @param {object} [runtime]
 * @returns {{
 *   enabled: boolean,
 *   days: number,
 *   intervalMs: number,
 *   minFreeRatio: number,
 *   minHours: number,
 * }}
 */
export function readRetentionConfig(runtime = {}) {
    const days = Number(runtime.tasksRetentionDays);
    const intervalMs = Number(runtime.tasksRetentionIntervalMs);
    const minFreeRatio = Number(runtime.tasksRetentionMinFreeRatio);
    const minHours = Number(runtime.tasksRetentionMinHours);
    return {
        enabled: runtime.tasksRetentionEnabled !== false && Number.isFinite(days) && days > 0,
        days: Number.isFinite(days) && days > 0 ? days : 0,
        intervalMs: Number.isFinite(intervalMs) && intervalMs >= 10_000 ? intervalMs : DEFAULT_RETENTION_INTERVAL_MS,
        minFreeRatio:
            Number.isFinite(minFreeRatio) && minFreeRatio > 0 && minFreeRatio < 1
                ? minFreeRatio
                : DEFAULT_MIN_FREE_RATIO,
        minHours: Number.isFinite(minHours) && minHours >= 1 ? minHours : DEFAULT_MIN_RETENTION_HOURS,
    };
}

/**
 * Scale the configured window down when the logs volume is short on free space.
 * At/above `minFreeRatio` keep `days`. As free → 0, approach `minHours`.
 *
 * @param {{ days: number, minFreeRatio: number, minHours: number }} cfg
 * @param {{ free: number, total: number, freeRatio: number } | null} disk
 * @returns {{ days: number, diskAdjusted: boolean, freeRatio: number | null }}
 */
export function effectiveRetentionDays(cfg, disk) {
    const minDays = cfg.minHours / 24;
    if (!disk || !Number.isFinite(disk.freeRatio) || disk.freeRatio >= cfg.minFreeRatio) {
        return { days: cfg.days, diskAdjusted: false, freeRatio: disk?.freeRatio ?? null };
    }
    const scaled = cfg.days * (disk.freeRatio / cfg.minFreeRatio);
    const days = Math.max(minDays, scaled);
    return { days, diskAdjusted: true, freeRatio: disk.freeRatio };
}

/**
 * @param {number} days
 * @param {Date} [now]
 * @returns {string} ISO cutoff
 */
export function retentionCutoffIso(days, now = new Date()) {
    const ms = Math.max(0, Number(days) || 0) * 24 * 60 * 60 * 1000;
    return new Date(now.getTime() - ms).toISOString();
}

export { getDiskUsage as readDiskUsage };

/**
 * Delete history rows older than `cutoff` in chunks (re-run safe).
 *
 * @param {Function} db
 * @param {string} historyTable
 * @param {string|Date} cutoff
 * @param {{ chunkSize?: number, isStop?: () => boolean }} [opts]
 * @returns {Promise<number>}
 */
export async function deleteHistoryOlderThan(db, historyTable, cutoff, opts = {}) {
    const chunkSize = Math.max(1, Number(opts.chunkSize) || HISTORY_PRUNE_CHUNK);
    const isStop = typeof opts.isStop === "function" ? opts.isStop : () => false;
    let total = 0;
    for (;;) {
        if (isStop()) break;
        const rows = await db(historyTable)
            .where("completed_at", "<", cutoff)
            .select("id")
            .limit(chunkSize);
        if (!Array.isArray(rows) || rows.length === 0) break;
        const ids = rows.map((r) => r.id).filter(Boolean);
        if (!ids.length) break;
        const deleted = await db(historyTable).whereIn("id", ids).delete();
        total += Number(deleted) || ids.length;
        if (rows.length < chunkSize) break;
    }
    return total;
}

/**
 * Run one prune pass: disk-aware cutoff → IPC logs → tasks_history.
 *
 * @param {object} context
 * @param {{
 *   queueName?: string,
 *   historyTable?: string,
 *   force?: boolean,
 *   now?: Date,
 *   readDisk?: (p: string) => Promise<{ free: number, total: number, freeRatio: number } | null>,
 *   pruneLogs?: typeof pruneIpcLogsOlderThan,
 * }} [options]
 * @returns {Promise<object>}
 */
export async function pruneTaskRetention(context, options = {}) {
    seedTaskRetentionRuntime(context);
    const cfg = readRetentionConfig(context.tasksRuntime);
    if (!cfg.enabled) {
        return { skipped: true, reason: "disabled" };
    }

    const queueName = options.queueName ?? context.tasksQueueName ?? "tasks";
    const historyTable = options.historyTable ?? queueToTableNames(queueName).historyTable;
    const now = options.now ?? new Date();
    const logsRoot = tasksLogsRoot(context);
    const readDisk = options.readDisk ?? getDiskUsage;
    const disk = await readDisk(logsRoot);
    const effective = effectiveRetentionDays(cfg, disk);
    const cutoff = retentionCutoffIso(effective.days, now);

    const pruneLogs = options.pruneLogs ?? pruneIpcLogsOlderThan;
    const logs = await pruneLogs(context, cutoff, {
        isStop: () => context.isStop?.() === true,
    });

    let historyDeleted = 0;
    if (context.db && typeof context.db === "function") {
        historyDeleted = await deleteHistoryOlderThan(context.db, historyTable, cutoff, {
            isStop: () => context.isStop?.() === true,
        });
    }

    const summary = {
        skipped: false,
        cutoff,
        days: effective.days,
        configuredDays: cfg.days,
        diskAdjusted: effective.diskAdjusted,
        freeRatio: effective.freeRatio,
        historyTable,
        historyDeleted,
        logs,
    };
    context.logger?.info?.(
        `[tasks-retention] cutoff=${cutoff} days=${effective.days.toFixed(2)}` +
            `${effective.diskAdjusted ? ` (disk ${(effective.freeRatio * 100).toFixed(1)}% free)` : ""}` +
            ` history=${historyDeleted} logTables=${logs?.tables ?? 0} logDropped=${logs?.dropped ?? 0}`,
    );
    return summary;
}

/**
 * Throttled prune for the runner loop / after each handler. Overlapping calls no-op.
 *
 * @param {object} context
 * @param {{ queueName?: string, historyTable?: string, force?: boolean }} [options]
 * @returns {Promise<object|null>}
 */
export async function maybePruneTaskRetention(context, options = {}) {
    seedTaskRetentionRuntime(context);
    const cfg = readRetentionConfig(context.tasksRuntime);
    if (!cfg.enabled) return null;

    const now = Date.now();
    const last = Number(context.__tasksRetentionLastAt) || 0;
    if (!options.force && last && now - last < cfg.intervalMs) return null;
    if (context.__tasksRetentionInFlight) return null;

    context.__tasksRetentionLastAt = now;
    context.__tasksRetentionInFlight = true;
    try {
        return await pruneTaskRetention(context, options);
    } catch (err) {
        context.logger?.warn?.(`[tasks-retention] prune failed: ${err?.message ?? String(err)}`);
        return { skipped: true, reason: "error", error: err?.message ?? String(err) };
    } finally {
        context.__tasksRetentionInFlight = false;
    }
}
