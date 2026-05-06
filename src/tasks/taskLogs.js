import path from "node:path";
import { FileDatabase } from "../filedatabase/index.js";

/**
 * Gets or lazily builds the default IPC-logs FileDatabase state, cached on
 * `context.__tasksLogsState`. Reads `tasksLogs*` params (basePath, namespace,
 * table, errorTable, enabled, maxVersions, pageSize). When `tasksLogsEnabled=false`
 * the main `db` is null but `errorDb` still captures error payloads.
 *
 * @param {object} context
 * @returns {object} `{ db, errorDb, queue, initialized, errorInitialized }`
 */
function getLogsState(context) {
    const holder = context;
    if (holder.__tasksLogsState) return holder.__tasksLogsState;

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
        const disabledState = {
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
    const state = {
        db,
        errorDb,
        queue: Promise.resolve(),
        initialized: false,
        errorInitialized: false,
    };
    holder.__tasksLogsState = state;
    return state;
}

/**
 * Cache key for a target so multiple writers sharing the same
 * `basePath`/`namespace`/`tableName` reuse one FileDatabase state
 * (see `getLogsStateForTarget`).
 *
 * @param {object} target `{ basePath?, namespace?, tableName }`
 * @returns {string}
 */
function ipcLogTargetKey(target) {
    const bp = target.basePath ?? "";
    const ns = target.namespace ?? "";
    return `${bp}::${ns}::${target.tableName}`;
}

/**
 * Produce a FileDatabase `tableName` of the form `source/resource`, sanitizing each
 * segment so only `[a-zA-Z0-9._-]` survive. Empty segments fall back to `"x"`.
 *
 * @param {string} source
 * @param {string} resource
 * @returns {string} e.g. `"actris/properties"`
 */
export function ipcFileLogsTableNameForSourceResource(source, resource) {
    const seg = (s) => {
        const t = String(s).trim().replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
        return t.length ? t : "x";
    };
    return `${seg(source)}/${seg(resource)}`;
}

/**
 * Read IPC log records from the latest FileDatabase version for `source/resource`.
 * Intended for tailing / incremental polling — use the returned `latestTs` as the
 * next call's `afterTs`.
 *
 * @param {object} context
 * @param {object} options
 * @param {string} options.source
 * @param {string} options.resource
 * @param {number} [options.tail=100]     Max records returned after filtering (clamped 1..10000).
 * @param {string|null} [options.afterTs] ISO timestamp watermark; keeps rows with `ts > afterTs`.
 * @returns {Promise<{ records: object[], latestTs: string|null }>}
 */
export async function readTaskIpcLogsSnapshot(context, options) {
    const holder = context;
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
    const latest = versions[versions.length - 1];
    const raw = await fd.read({ version: latest });
    const arr = Array.isArray(raw) ? raw : [];

    let filtered = arr;
    if (options.afterTs && String(options.afterTs).trim()) {
        const cut = String(options.afterTs).trim();
        filtered = arr.filter((r) => r && typeof r.ts === "string" && String(r.ts) > cut);
    }

    /** Watermark for incremental fetches: max `ts` among all matching rows, not only the returned tail. */
    let latestTs = null;
    for (const r of filtered) {
        const ts = typeof r?.ts === "string" ? String(r.ts) : null;
        if (ts && (!latestTs || ts > latestTs)) latestTs = ts;
    }

    const incremental = !!(options.afterTs && String(options.afterTs).trim());
    /** Incremental polls may return many lines between ticks — cap at 10k so we do not drop rows then advance `latestTs` past them. */
    const maxReturn = incremental ? 10_000 : tail;
    const sliced = filtered.length > maxReturn ? filtered.slice(-maxReturn) : filtered;

    return { records: sliced, latestTs };
}

/**
 * Absolute path to the FileDatabase table directory for a given target (matches the
 * FileDatabase on-disk layout). Versioned writes create timestamp subfolders inside.
 *
 * @param {object} context
 * @param {object} target `{ basePath?, namespace?, tableName }`
 * @returns {string}
 */
export function resolveIpcFileLogsDir(context, target) {
    const holder = context;
    const basePath = target.basePath ?? (holder.params?.get?.("tasksLogsBasePath") || "./data");
    const namespace = target.namespace ?? (holder.params?.get?.("tasksLogsNamespace") || "tasks-logs");
    const segments = target.tableName.split("/").filter(Boolean);
    return path.resolve(basePath, namespace, ...segments);
}

/**
 * Lazily build a FileDatabase state for the given target, memoized on
 * `context.__tasksLogsTargetStates` (Map keyed by `ipcLogTargetKey`).
 * Returns `null` when `tasksLogsEnabled=false`.
 *
 * @param {object} context
 * @param {object} target `{ basePath?, namespace?, tableName }`
 * @returns {object|null} same shape as `getLogsState`, but `errorDb` is always null.
 */
function getLogsStateForTarget(context, target) {
    const holder = context;
    const enabledRaw = holder.params?.get?.("tasksLogsEnabled");
    const enabled = enabledRaw === undefined ? true : !!enabledRaw;
    if (!enabled) return null;

    if (!holder.__tasksLogsTargetStates) holder.__tasksLogsTargetStates = new Map();
    const map = holder.__tasksLogsTargetStates;
    const key = ipcLogTargetKey(target);
    if (map.has(key)) return map.get(key);

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
    const state = {
        db,
        errorDb: null,
        queue: Promise.resolve(),
        initialized: false,
        errorInitialized: false,
    };
    map.set(key, state);
    return state;
}

/**
 * Heuristic: does this IPC payload represent an error?
 *   - object with `level` of `"error"`/`"fatal"`, OR
 *   - object with a `message` string containing the word "error", OR
 *   - plain string containing "error" (case-insensitive).
 *
 * @param {unknown} payload
 * @returns {boolean}
 */
function isErrorPayload(payload) {
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

/**
 * Build the persisted log record for an IPC payload. Copies `source`/`resource` from
 * `task.params` when present so logs stay queryable by them later.
 *
 * @param {object} task
 * @param {unknown} payload
 * @returns {object} `{ ts, opid, taskId, taskName, target, source, resource, payload }`
 */
function buildLogRecord(task, payload) {
    const params = task.params && typeof task.params === "object" ? task.params : {};
    return {
        ts: new Date().toISOString(),
        opid: task.opid ?? null,
        taskId: task.id,
        taskName: task.name,
        target: task.service_group,
        source: typeof params.source === "string" ? params.source : null,
        resource: typeof params.resource === "string" ? params.resource : null,
        payload,
    };
}

/**
 * Append one IPC log line from a child worker. Never throws; writes are serialized
 * per-state on a promise queue (drain with `flushTaskIpcLogs`).
 *
 *   - Without `target`: writes to the default store (`tasksLogsTable`, usually `runner`)
 *     and, when the payload looks like an error, also to `tasksErrorLogsTable`.
 *   - With `target`: writes only to that target's store (e.g. per source/resource,
 *     later read by `readTaskIpcLogsSnapshot`).
 *
 * @param {object} context
 * @param {object} task
 * @param {unknown} payload
 * @param {object} [target] `{ basePath?, namespace?, tableName }`
 * @returns {void}
 */
export function appendTaskIpcLog(context, task, payload, target) {
    if (target) {
        const state = getLogsStateForTarget(context, target);
        if (!state?.db) return;
        const record = buildLogRecord(task, payload);
        state.queue = state.queue
            .then(async () => {
                await state.db.write([record], { forceNewVersion: !state.initialized });
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

/**
 * Await pending FileDatabase writes from task IPC logging (default store + every
 * per-target store). Does not close anything; subsequent appends continue to work.
 *
 * @param {object} context
 * @returns {Promise<void>}
 */
export async function flushTaskIpcLogs(context) {
    const holder = context;
    const promises = [];
    if (holder.__tasksLogsState?.queue) promises.push(holder.__tasksLogsState.queue);
    const map = holder.__tasksLogsTargetStates;
    if (map) {
        for (const s of map.values()) {
            if (s.queue) promises.push(s.queue);
        }
    }
    await Promise.all(promises);
}
