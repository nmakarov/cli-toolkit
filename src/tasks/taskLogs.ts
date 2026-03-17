import { FileDatabase } from "../filedatabase/index.js";
import type { Context } from "../init/types.js";
import type { TaskRow } from "./types.js";

type LogsState = {
    db: FileDatabase;
    errorDb: FileDatabase;
    queue: Promise<void>;
    initialized: boolean;
    errorInitialized: boolean;
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
            db: null as any,
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
    const params = (task.params && typeof task.params === "object") ? task.params : {};
    return {
        ts: new Date().toISOString(),
        opid: task.opid ?? null,
        taskId: task.id,
        taskName: task.task,
        target: task.target,
        source: typeof (params as any).source === "string" ? (params as any).source : null,
        resource: typeof (params as any).resource === "string" ? (params as any).resource : null,
        payload,
    };
}

export function appendTaskIpcLog(context: Context, task: TaskRow, payload: any): void {
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
