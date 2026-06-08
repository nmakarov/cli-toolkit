import { spawn } from "node:child_process";
import {
    appendTaskIpcLog,
    flushTaskIpcLogs,
    resolveIpcFileLogsDir,
} from "./taskLogs.js";

/** Upper bound on the `progress` column write; keeps a runaway child from bloating the row. */
const MAX_PROGRESS_TEXT_LEN = 4000;

/**
 * Remove empty / non-string entries from a CLI args array.
 *
 * @param {unknown[]} [args]
 * @returns {string[]}
 */
function toCliArgs(args = []) {
    return args.filter((a) => typeof a === "string" && a.length > 0);
}

/**
 * Short prefix for child-side log lines: `<taskName>:<id8>[:<opid>]`.
 *
 * @param {{ name: string, id: string, opid?: string|null }} task
 * @returns {string}
 */
function formatChildLogPrefix(task) {
    return `${task.name}:${task.id.slice(0, 8)}${task.opid ? `:${task.opid}` : ""}`;
}

/**
 * True progress event: must carry `level === "progress"` and numeric `count`/`total`.
 * Anything else (debug, info, error, worker-result sentinel...) is treated as a regular log.
 *
 * @param {unknown} payload
 * @returns {boolean}
 */
function isProgressPayload(payload) {
    if (!payload || typeof payload !== "object") return false;
    if (payload.level !== "progress") return false;
    const count = Number(payload.count);
    const total = Number(payload.total);
    return Number.isFinite(count) && Number.isFinite(total) && total > 0;
}

/**
 * Render a progress payload as `"[prefix ][message ]count/total"` for the DB `progress` column.
 *
 * @param {{ prefix?: string, message?: string, count: number, total: number }} payload
 * @param {string} fallbackPrefix Used when `payload.prefix` is missing.
 * @returns {string}
 */
function formatProgressText(payload, fallbackPrefix) {
    const pfx = payload.prefix ? `${payload.prefix} ` : (fallbackPrefix ? `${fallbackPrefix} ` : "");
    const label = typeof payload.message === "string" && payload.message ? `${payload.message} ` : "";
    return `${pfx}${label}${payload.count}/${payload.total}`;
}

/**
 * Forward a structured IPC log line from the child to the parent's logger at the
 * matching level. `stdout`/`stderr` go through a different path (raw forwarding);
 * this only handles `{ level, message, ... }` payloads.
 *
 * @param {object} context
 * @param {string} prefix
 * @param {unknown} message
 * @returns {void}
 */
function forwardChildLogToParent(context, prefix, message) {
    if (!message || typeof message !== "object") return;
    const text = typeof message.message === "string" ? message.message : null;
    if (!text) return;
    const level = typeof message.level === "string" ? message.level.toLowerCase() : "";
    const line = `[child:${prefix}] ${text}`;
    const logger = context.logger;
    switch (level) {
        case "error":
        case "fatal":
            logger.error?.(line);
            return;
        case "warn":
        case "warning":
            logger.warn?.(line);
            return;
        case "debug":
            logger.debug?.(line);
            return;
        case "info":
        default:
            logger.info?.(line);
    }
}

/**
 * Build the `node` argv for `spawn`. Workers are plain `.js` (ESM), so we just
 * run them with `node`. Any exec flags the parent was started with (e.g.
 * `--inspect`) are inherited so child workers behave consistently.
 *
 * @param {string} scriptPath
 * @param {string[]} cliArgs
 * @returns {string[]}
 */
function buildNodeArgs(scriptPath, cliArgs) {
    const inheritedExecArgs = Array.isArray(process.execArgv) ? [...process.execArgv] : [];
    return [...inheritedExecArgs, scriptPath, ...cliArgs];
}

/**
 * Where progress writes land: `context.tasksQueueName` > `params.get("table")` > `"tasks"`.
 *
 * @param {object} context
 * @returns {string}
 */
function resolveTasksTableName(context) {
    return context.tasksQueueName || context.params?.get?.("table") || "tasks";
}

/**
 * Announce the IPC-file-logs target once at spawn time. Emits a single info line
 * with the resolved directory and notes when `tasksLogsEnabled=false` keeps logs in-memory only.
 *
 * @param {object} context
 * @param {{ ipcFileLogs?: { basePath?: string, namespace?: string, tableName: string } }} options
 * @returns {void}
 */
function announceIpcFileLogsTarget(context, options) {
    if (!options.ipcFileLogs) return;
    const logsDir = resolveIpcFileLogsDir(context, options.ipcFileLogs);
    const enabledRaw = context.params?.get?.("tasksLogsEnabled");
    const logsEnabled = enabledRaw === undefined ? true : !!enabledRaw;
    context.logger.info?.(
        `[tasks] IPC file logs: ${logsDir}` +
            (logsEnabled ? "" : " (tasksLogsEnabled=false; not persisted)")
    );
}

/**
 * Single-consumer FIFO for async work: each `push` runs after the previous one
 * finishes (success or failure). Thrown errors are swallowed by the chain so one
 * bad task never wedges the rest; callers handle errors inside their own `fn`.
 *
 * @returns {{ push: (fn: () => Promise<void>) => Promise<void>, drain: () => Promise<void> }}
 */
function createSerializedQueue() {
    let chain = Promise.resolve();
    return {
        push(fn) {
            chain = chain.then(fn, () => {}).catch(() => {});
            return chain;
        },
        drain() {
            return chain.catch(() => {});
        },
    };
}

/**
 * Fork `scriptPath` as a Node child with IPC, forward its stdio + IPC logs to the
 * parent logger, update the task row's `progress` column on `{ level: "progress" }`
 * payloads, and resolve with a summary once the child closes.
 *
 * Contract:
 *   - **Only** IPC payloads matching {@link isProgressPayload} touch the `progress` column.
 *     stdout/stderr are diagnostic — accumulated and forwarded to logger but never
 *     persisted to `progress`.
 *   - The worker returns its final value via `process.send({ __taskWorkerResult: ... })`;
 *     that sentinel is captured and exposed as `workerResult`.
 *   - DB write and `onProgress` callback for a given payload run sequentially on a shared
 *     queue so ordering is preserved across rapid updates.
 *
 * @param {object} context
 * @param {{
 *   scriptPath: string,
 *   task: { id: string, name: string, opid?: string|null },
 *   args?: string[],
 *   cwd?: string,
 *   onProgress?: (progressText: string) => unknown | Promise<unknown>,
 *   onChildIpcMessage?: (message: unknown) => void,
 *   ipcFileLogs?: { basePath?: string, namespace?: string, tableName: string },
 * }} options
 * @returns {Promise<{
 *   exitCode: number | null,
 *   signal: NodeJS.Signals | null,
 *   stdout: string,
 *   stderr: string,
 *   workerResult: unknown,
 *   hadErrorMessage: boolean,
 * }>}
 */
export async function runNodeTaskScript(context, options) {
    const cliArgs = toCliArgs(["--route=ipc", "--mode=json", ...(options.args || [])]);
    const nodeArgs = buildNodeArgs(options.scriptPath, cliArgs);
    const child = spawn(process.execPath, nodeArgs, {
        cwd: options.cwd || process.cwd(),
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        env: {
            ...process.env,
            TASK_ID: options.task.id,
            TASK_NAME: options.task.name,
            TASK_OPID: options.task.opid || "",
        },
    });

    announceIpcFileLogsTarget(context, options);

    const prefix = formatChildLogPrefix(options.task);
    const tasksTable = resolveTasksTableName(context);
    const progressQueue = createSerializedQueue();

    const state = {
        stdout: "",
        stderr: "",
        workerResult: null,
        hadErrorMessage: false,
    };

    /**
     * Serialize a progress update: write to DB, then invoke the optional callback.
     * Each half is independently try/caught so one failure doesn't skip the other.
     *
     * @param {string} text
     */
    const writeProgress = (text) => {
        const trimmed = typeof text === "string" ? text.slice(0, MAX_PROGRESS_TEXT_LEN) : "";
        if (!trimmed) return;
        progressQueue.push(async () => {
            const db = context.db;
            if (db) {
                try {
                    await db(tasksTable).where({ id: options.task.id }).update({ progress: trimmed });
                } catch (error) {
                    context.logger.warn?.(
                        `[tasks] failed to update progress for task=${options.task.id}: ${error?.message ?? String(error)}`
                    );
                }
            }
            if (options.onProgress) {
                try {
                    await options.onProgress(trimmed);
                } catch (error) {
                    context.logger.warn?.(
                        `[tasks] reportProgress callback failed for task=${options.task.id}: ${error?.message ?? String(error)}`
                    );
                }
            }
        });
    };

    child.stdout?.on("data", (chunk) => {
        const text = String(chunk);
        state.stdout += text;
        if (text.trim()) {
            context.logger.info?.(`[child:${prefix}] ${text.trimEnd()}`);
        }
    });
    child.stderr?.on("data", (chunk) => {
        const text = String(chunk);
        state.stderr += text;
        if (text.trim()) {
            context.logger.warn?.(`[child:${prefix}] ${text.trimEnd()}`);
        }
    });

    child.on("message", (message) => {
        if (message && typeof message === "object" && "__taskWorkerResult" in message) {
            state.workerResult = message.__taskWorkerResult;
            return;
        }

        if (message && typeof message === "object") {
            const level = typeof message.level === "string" ? message.level.toLowerCase() : "";
            if (level === "error" || level === "fatal") {
                state.hadErrorMessage = true;
            }
        }

        appendTaskIpcLog(context, options.task, message, options.ipcFileLogs);

        try {
            options.onChildIpcMessage?.(message);
        } catch (e) {
            context.logger.warn?.(`[tasks] onChildIpcMessage failed: ${e?.message ?? String(e)}`);
        }

        if (isProgressPayload(message)) {
            context.logger.progress(message.message || "progress", {
                prefix: message.prefix || prefix,
                count: Number(message.count),
                total: Number(message.total),
            });
            writeProgress(formatProgressText(message, prefix));
            return;
        }

        forwardChildLogToParent(context, prefix, message);
    });

    return await new Promise((resolve, reject) => {
        child.on("error", (error) => reject(error));
        child.on("close", (exitCode, signal) => {
            void (async () => {
                await flushTaskIpcLogs(context);
                await progressQueue.drain();
                resolve({
                    exitCode,
                    signal,
                    stdout: state.stdout.trim(),
                    stderr: state.stderr.trim(),
                    workerResult: state.workerResult,
                    hadErrorMessage: state.hadErrorMessage,
                });
            })();
        });
    });
}
