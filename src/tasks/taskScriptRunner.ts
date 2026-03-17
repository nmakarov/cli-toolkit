import { spawn } from "node:child_process";
import type { Context } from "../init/types.js";
import type { TaskRow } from "./types.js";
import { appendTaskIpcLog } from "./taskLogs.js";

export type TaskScriptRunResult = {
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
    workerResult: any;
    hadErrorMessage: boolean;
};

type TaskScriptRunOptions = {
    scriptPath: string;
    args?: string[];
    cwd?: string;
    task: TaskRow;
    onProgress?: (progress: any) => Promise<void>;
};

function toCliArgs(args: string[] = []): string[] {
    return args.filter((a) => typeof a === "string" && a.length > 0);
}

function formatChildLogPrefix(task: TaskRow): string {
    return `${task.task}:${task.id.slice(0, 8)}${task.opid ? `:${task.opid}` : ""}`;
}

export async function runNodeTaskScript(context: Context, options: TaskScriptRunOptions): Promise<TaskScriptRunResult> {
    const cliArgs = toCliArgs(["--route=ipc", "--mode=json", ...(options.args || [])]);
    const inheritedExecArgs = Array.isArray(process.execArgv) ? [...process.execArgv] : [];
    const hasTsRuntimeInParent = inheritedExecArgs.some((arg) => /tsx|ts-node/i.test(arg));
    const nodeArgs = hasTsRuntimeInParent
        ? [...inheritedExecArgs, options.scriptPath, ...cliArgs]
        : ["--import", "tsx", options.scriptPath, ...cliArgs];

    const child = spawn(
        process.execPath,
        nodeArgs,
        {
            cwd: options.cwd || process.cwd(),
            stdio: ["ignore", "pipe", "pipe", "ipc"],
            env: {
                ...process.env,
                TASK_ID: options.task.id,
                TASK_NAME: options.task.task,
                TASK_OPID: options.task.opid || "",
            },
        }
    );

    let stdout = "";
    let stderr = "";
    let workerResult: any = null;
    let hadErrorMessage = false;
    const prefix = formatChildLogPrefix(options.task);
    const db = (context as any).db;
    const tasksTable = (context as any).params?.get?.("table") || "tasks";
    let progressWriteChain: Promise<void> = Promise.resolve();
    let progressCallbackChain: Promise<void> = Promise.resolve();

    const updateProgress = (text: string): void => {
        if (!db || !text || !text.trim()) return;
        progressWriteChain = progressWriteChain
            .then(async () => {
                await db(tasksTable).where({ id: options.task.id }).update({ progress: text.slice(0, 4000) });
            })
            .catch((error: any) => {
                context.logger.warn?.(
                    `[tasks] failed to update progress for task=${options.task.id}: ${error?.message ?? String(error)}`
                );
            });
        if (options.onProgress) {
            progressCallbackChain = progressCallbackChain
                .then(async () => {
                    await options.onProgress?.(text.slice(0, 4000));
                })
                .catch((error: any) => {
                    context.logger.warn?.(
                        `[tasks] reportProgress callback failed for task=${options.task.id}: ${error?.message ?? String(error)}`
                    );
                });
        }
    };

    const payloadToProgressText = (payload: any): string => {
        if (!payload) return "";
        if (typeof payload === "string") return payload;
        if (typeof payload.message === "string" && payload.level === "progress" && payload.count !== undefined && payload.total !== undefined) {
            const pfx = payload.prefix ? `${payload.prefix} ` : "";
            return `${pfx}${payload.message} ${payload.count}/${payload.total}`;
        }
        if (typeof payload.message === "string") return payload.message;
        if (payload.level === "progress" && payload.count !== undefined && payload.total !== undefined) {
            const pfx = payload.prefix ? `${payload.prefix} ` : "";
            return `${pfx}${payload.count}/${payload.total}`;
        }
        return "";
    };

    child.stdout.on("data", (chunk) => {
        const text = String(chunk);
        stdout += text;
        if (text.trim()) {
            context.logger.info?.(`[child:${prefix}] ${text.trimEnd()}`);
            updateProgress(text.trim().replace(/\s+/g, " ").slice(0, 400));
        }
    });
    child.stderr.on("data", (chunk) => {
        const text = String(chunk);
        stderr += text;
        if (text.trim()) {
            context.logger.warn?.(`[child:${prefix}] ${text.trimEnd()}`);
        }
    });

    child.on("message", (message: any) => {
        if (message && typeof message === "object" && "__taskWorkerResult" in message) {
            workerResult = message.__taskWorkerResult;
            return;
        }
        if (message && typeof message === "object") {
            const level = typeof message.level === "string" ? message.level.toLowerCase() : "";
            if (level === "error" || level === "fatal") {
                hadErrorMessage = true;
            }
        }
        appendTaskIpcLog(context, options.task, message);
        const progressText = payloadToProgressText(message);
        if (progressText) {
            updateProgress(progressText);
            if (typeof message === "object" && message?.level === "progress" && message.count !== undefined && message.total !== undefined) {
                const countNum = Number(String(message.count).trim());
                const totalNum = Number(message.total);
                if (Number.isFinite(countNum) && Number.isFinite(totalNum) && totalNum > 0) {
                    context.logger.progress(message.message || "progress", {
                        prefix: message.prefix || prefix,
                        count: countNum,
                        total: totalNum,
                    });
                } else {
                    context.logger.info?.(`[child:${prefix}] ${progressText}`);
                }
            } else {
                context.logger.info?.(`[child:${prefix}] ${progressText}`);
            }
        }
    });

    return await new Promise<TaskScriptRunResult>((resolve, reject) => {
        child.on("error", (error) => reject(error));
        child.on("close", (exitCode, signal) => {
            Promise.allSettled([progressWriteChain, progressCallbackChain]).finally(() => {
                resolve({
                    exitCode,
                    signal,
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                    workerResult,
                    hadErrorMessage,
                });
            });
        });
    });
}
