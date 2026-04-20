import path from "node:path";
import { FileDatabase } from "../filedatabase/index.js";
import type { Context } from "../init/types.js";
import type { TaskRow } from "./types.js";

type LogsState = {
    db: FileDatabase | null;
    errorDb: FileDatabase | null;
    queue: Promise<void>;
    initialized: boolean;
    errorInitialized: boolean;
};

/** Optional FileDatabase destination for IPC log lines (e.g. per source/resource). */
export type IpcFileLogTarget = {
    /** Default: `./data` or `tasksLogsBasePath` param */
    basePath?: string;
    /** Default: `tasks-logs` or `tasksLogsNamespace` param */
    namespace?: string;
    /** Table path segment(s), e.g. `actris/members` → `basePath/tasks-logs/actris/members/...` */
    tableName: string;
};

function getLogsState(context: Context): LogsState {
    const holder = context as any;
    if (holder.__tasksLogsState) return holder.__tasksLogsState as LogsState;

    const basePath = holder.params?.get?.("tasksLogsBasePath") || "./data";
    const namespace = holder.params?.get?.("tasksLogsNamespace") || "tasks-logs";
    const tableName = holder.params?.get?.("tasksLogsTable") || "runner";
    const errorTableName = holder.params?.get?.("tasksErrorLogsTable") || `${tableName}-errors`;
    const maxVersionsRaw = Number(holder.params?.get?.("tasksLogsMaxVersions"));
    const pageSizeRaw = Number(holder.params?.get?.("tasksLogsPageSize"));

    const errorDb = new FileDatabase({
        basePath,
        namespace,
        tableName: errorTableName,
        versioned: true,
        useMetadata: true,
        maxVersions: Number.isFinite(maxVersionsRaw) && maxVersionsRaw > 0 ? maxVersionsRaw : 20,
        pageSize: Number.isFinite(pageSizeRaw) && pageSizeRaw > 0 ? pageSizeRaw : 2000,
        logger: holder.logger,
    });

    const enabledRaw = holder.params?.get?.("tasksLogsEnabled");
    const enabled = enabledRaw === undefined ? true : !!enabledRaw;
    if (!enabled) {
        const disabledState: LogsState = {
            db: null,
            errorDb,
            queue: Promise.resolve(),
            initialized: true,
            errorInitialized: false,
        };
        holder.__tasksLogsState = disabledState;
        return disabledState;
    }

    const db = new FileDatabase({
        basePath,
        namespace,
        tableName,
        versioned: true,
        useMetadata: true,
        maxVersions: Number.isFinite(maxVersionsRaw) && maxVersionsRaw > 0 ? maxVersionsRaw : 20,
        pageSize: Number.isFinite(pageSizeRaw) && pageSizeRaw > 0 ? pageSizeRaw : 2000,
        logger: holder.logger,
    });
    const state: LogsState = {
        db,
        errorDb,
        queue: Promise.resolve(),
        initialized: false,
        errorInitialized: false,
    };
    holder.__tasksLogsState = state;
    return state;
}

function ipcLogTargetKey(target: IpcFileLogTarget): string {
    const bp = target.basePath ?? "";
    const ns = target.namespace ?? "";
    return `${bp}::${ns}::${target.tableName}`;
}

/**
 * Safe path segment for FileDatabase `tableName` (allows `source/resource` layout).
 */
export function ipcFileLogsTableNameForSourceResource(source: string, resource: string): string {
    const seg = (s: string) => {
        const t = String(s).trim().replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
        return t.length ? t : "x";
    };
    return `${seg(source)}/${seg(resource)}`;
}

export type ReadTaskIpcLogsOptions = {
    source: string;
    resource: string;
    /** Max records to return after filtering (default 100). */
    tail?: number;
    /** ISO timestamp; keep records with `ts` strictly greater than this (for incremental fetch). */
    afterTs?: string | null;
};

/**
 * Read IPC log records from the latest FileDatabase version for `source/resource`.
 */
export async function readTaskIpcLogsSnapshot(
    context: Context,
    options: ReadTaskIpcLogsOptions
): Promise<{ records: Record<string, unknown>[]; latestTs: string | null }> {
    const holder = context as any;
    const basePath = holder.params?.get?.("tasksLogsBasePath") ?? "./data";
    const namespace = holder.params?.get?.("tasksLogsNamespace") ?? "tasks-logs";
    const tableName = ipcFileLogsTableNameForSourceResource(options.source, options.resource);
    const tail = Math.max(1, Math.min(10_000, Number(options.tail) > 0 ? Number(options.tail) : 100));

    const fd = new FileDatabase({
        basePath,
        namespace,
        tableName,
        versioned: true,
        useMetadata: true,
        maxVersions: 30,
        pageSize: 2000,
        logger: holder.logger,
    });

    const versions = await fd.getVersions();
    if (versions.length === 0) {
        return { records: [], latestTs: null };
    }
    const latest = versions[versions.length - 1]!;
    const raw = await fd.read({ version: latest });
    const arr: Record<string, unknown>[] = Array.isArray(raw) ? raw : [];

    let filtered = arr;
    if (options.afterTs && String(options.afterTs).trim()) {
        const cut = String(options.afterTs).trim();
        filtered = arr.filter((r) => r && typeof (r as any).ts === "string" && String((r as any).ts) > cut);
    }

    /** Watermark for incremental fetches: max `ts` among all matching rows, not only the returned tail. */
    let latestTs: string | null = null;
    for (const r of filtered) {
        const ts = typeof (r as any)?.ts === "string" ? String((r as any).ts) : null;
        if (ts && (!latestTs || ts > latestTs)) latestTs = ts;
    }

    const incremental = !!(options.afterTs && String(options.afterTs).trim());
    /** Incremental polls may return many lines between ticks — cap at 10k so we do not drop rows then advance `latestTs` past them. */
    const maxReturn = incremental ? 10_000 : tail;
    const sliced = filtered.length > maxReturn ? filtered.slice(-maxReturn) : filtered;

    return { records: sliced, latestTs };
}

/**
 * Absolute path to the FileDatabase table directory for this target (matches {@link FileDatabase} layout).
 * Versioned writes create timestamp subfolders inside this directory.
 */
export function resolveIpcFileLogsDir(context: Context, target: IpcFileLogTarget): string {
    const holder = context as any;
    const basePath = target.basePath ?? (holder.params?.get?.("tasksLogsBasePath") || "./data");
    const namespace = target.namespace ?? (holder.params?.get?.("tasksLogsNamespace") || "tasks-logs");
    const segments = target.tableName.split("/").filter(Boolean);
    return path.resolve(basePath, namespace, ...segments);
}

function getLogsStateForTarget(context: Context, target: IpcFileLogTarget): LogsState | null {
    const holder = context as any;
    const enabledRaw = holder.params?.get?.("tasksLogsEnabled");
    const enabled = enabledRaw === undefined ? true : !!enabledRaw;
    if (!enabled) return null;

    if (!holder.__tasksLogsTargetStates) holder.__tasksLogsTargetStates = new Map<string, LogsState>();
    const map = holder.__tasksLogsTargetStates as Map<string, LogsState>;
    const key = ipcLogTargetKey(target);
    if (map.has(key)) return map.get(key)!;

    const basePath = target.basePath ?? (holder.params?.get?.("tasksLogsBasePath") || "./data");
    const namespace = target.namespace ?? (holder.params?.get?.("tasksLogsNamespace") || "tasks-logs");
    const maxVersionsRaw = Number(holder.params?.get?.("tasksLogsMaxVersions"));
    const pageSizeRaw = Number(holder.params?.get?.("tasksLogsPageSize"));

    const db = new FileDatabase({
        basePath,
        namespace,
        tableName: target.tableName,
        versioned: true,
        useMetadata: true,
        maxVersions: Number.isFinite(maxVersionsRaw) && maxVersionsRaw > 0 ? maxVersionsRaw : 20,
        pageSize: Number.isFinite(pageSizeRaw) && pageSizeRaw > 0 ? pageSizeRaw : 2000,
        logger: holder.logger,
    });
    const state: LogsState = {
        db,
        errorDb: null,
        queue: Promise.resolve(),
        initialized: false,
        errorInitialized: false,
    };
    map.set(key, state);
    return state;
}

function isErrorPayload(payload: any): boolean {
    if (!payload) return false;
    if (typeof payload === "object") {
        const level = typeof payload.level === "string" ? payload.level.toLowerCase() : "";
        if (level === "error" || level === "fatal") return true;
        if (typeof payload.message === "string" && /\berror\b/i.test(payload.message)) return true;
        return false;
    }
    if (typeof payload === "string") {
        return /\berror\b/i.test(payload);
    }
    return false;
}

function buildLogRecord(task: TaskRow, payload: any): Record<string, any> {
    const params = task.params && typeof task.params === "object" ? task.params : {};
    return {
        ts: new Date().toISOString(),
        opid: task.opid ?? null,
        taskId: task.id,
        taskName: task.name,
        target: task.service_group,
        source: typeof (params as any).source === "string" ? (params as any).source : null,
        resource: typeof (params as any).resource === "string" ? (params as any).resource : null,
        payload,
    };
}

/**
 * Append one IPC log line from a child worker. Without `target`, uses the default `tasks-logs` / `runner` store.
 * With `target`, writes only to that table (e.g. per source/resource for later `getLogs`).
 */
export function appendTaskIpcLog(context: Context, task: TaskRow, payload: any, target?: IpcFileLogTarget): void {
    if (target) {
        const state = getLogsStateForTarget(context, target);
        if (!state?.db) return;
        const record = buildLogRecord(task, payload);
        state.queue = state.queue
            .then(async () => {
                await state.db!.write([record], { forceNewVersion: !state.initialized });
                state.initialized = true;
            })
            .catch((error) => {
                context.logger.warn?.("[tasks] failed to persist IPC log entry (targeted):", error);
            });
        return;
    }

    const state = getLogsState(context);
    if (!state.db && !state.errorDb) return;

    const record = buildLogRecord(task, payload);
    state.queue = state.queue
        .then(async () => {
            if (state.db) {
                await state.db.write([record], { forceNewVersion: !state.initialized });
                state.initialized = true;
            }
            if (state.errorDb && isErrorPayload(payload)) {
                await state.errorDb.write([record], { forceNewVersion: !state.errorInitialized });
                state.errorInitialized = true;
            }
        })
        .catch((error) => {
            context.logger.warn?.("[tasks] failed to persist IPC log entry:", error);
        });
}

/** Await pending FileDatabase writes from task IPC logging (default + per-target). */
export async function flushTaskIpcLogs(context: Context): Promise<void> {
    const holder = context as any;
    const promises: Promise<void>[] = [];
    if (holder.__tasksLogsState?.queue) promises.push(holder.__tasksLogsState.queue);
    const map = holder.__tasksLogsTargetStates as Map<string, LogsState> | undefined;
    if (map) {
        for (const s of map.values()) {
            if (s.queue) promises.push(s.queue);
        }
    }
    await Promise.all(promises);
}
