import path from "node:path";
import { fileURLToPath } from "node:url";
import { enqueueTask, runNodeTaskScript } from "../../src/tasks/index.js";
import { TaskMaster } from "../../src/tasks/TaskMaster.js";

import { countRunningTasksByName, getNumberParam, getQueueTableName } from "./dummyTaskRuntime.js";

function toPositiveInt(value, fallback) {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) return fallback;
    return n;
}

function shellQuote(value) {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export class TaskDummyLoad extends TaskMaster {
    async cantRunReason() {
        const limit = getNumberParam(this.context, "dummyLoadMaxParallel", 2);
        const running = await countRunningTasksByName(this.context, "dummyLoad");
        if (running >= limit) {
            return `dummyLoad concurrency limit reached (${running}/${limit})`;
        }
        return false;
    }

    async run(reportProgress) {
        const sourceRaw = this.task?.params?.source;
        const resourceRaw = this.task?.params?.resource;
        const recordsRaw = this.task?.params?.recordsCount ?? this.task?.params?.records ?? 0;
        const delayMs = toPositiveInt(this.task?.params?.loadDelayMs, 150);
        const batchSize = toPositiveInt(this.task?.params?.loadBatchSize, 25);
        const loadErrorChance = Number(this.task?.params?.loadErrorChance ?? 0);
        const listingId = typeof this.task?.params?.listingId === "string" ? this.task.params.listingId : "";
        const photoUrls = Array.isArray(this.task?.params?.photoUrls) ? this.task.params.photoUrls : [];

        const source = typeof sourceRaw === "string" ? sourceRaw.trim() : "";
        const resource = typeof resourceRaw === "string" ? resourceRaw.trim() : "";
        const recordsCount = toPositiveInt(recordsRaw, 0);

        if (!source || !resource) {
            return {
                success: false,
                results: {
                    error: 'Validation failed: "source" and "resource" are required',
                    received: this.task?.params ?? null,
                },
            };
        }

        const scriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "scripts", "dummy-load-worker.ts");
        const run = await runNodeTaskScript(this.context, {
            scriptPath,
            task: this.task,
            onProgress: reportProgress,
            args: [
                `--source=${source}`,
                `--resource=${resource}`,
                `--recordsCount=${recordsCount}`,
                `--loadDelayMs=${delayMs}`,
                `--loadBatchSize=${batchSize}`,
                `--loadErrorChance=${loadErrorChance}`,
                listingId ? `--listingId=${listingId}` : "",
                `--photoUrlsJson=${JSON.stringify(photoUrls)}`,
                this.task.opid ? `--opid=${this.task.opid}` : "",
            ],
        });

        const dbName = String((this.context )?.params?.get?.("dbName") || "local");
        const table = String((this.context )?.params?.get?.("table") || "tasks");
        const rerunCommand = [
            "npx",
            "tsx",
            "examples/tasks/recover-task.ts",
            `--dbName=${shellQuote(dbName)}`,
            `--table=${shellQuote(table)}`,
            `--id=${shellQuote(this.task.id)}`,
        ].join(" ");

        const loadedRaw = run.workerResult?.loaded;
        const hasValidResult = Number.isFinite(Number(loadedRaw));
        if (run.exitCode !== 0 || run.hadErrorMessage || !hasValidResult) {
            this.context.logger.error?.(
                `[TaskDummyLoad] failed for ${source}/${resource}. Once fixed, rerun standalone worker: ${rerunCommand}`
            );
            return {
                success: false,
                results: {
                    error: "dummy-load-worker failed",
                    exitCode: run.exitCode,
                    hadErrorMessage: run.hadErrorMessage,
                    hasValidWorkerResult: hasValidResult,
                    stderr: run.stderr,
                    stdout: run.stdout,
                    opid: this.task.opid ?? null,
                    rerunCommand,
                    rerunHint: `Once problem is fixed, you can re-run this task by running: ${rerunCommand}. This queue-aware recovery will update task progress/status and enqueue dummyPhotos automatically (for properties) if successful.`,
                },
            };
        }

        const loaded = Number(loadedRaw);
        const listing = run.workerResult?.listingId || listingId || null;
        const photos = Array.isArray(run.workerResult?.photoUrls) ? run.workerResult.photoUrls : photoUrls;

        let nextTaskId = null;
        if (resource === "properties" && listing && photos.length > 0) {
            const queue = getQueueTableName(this.context);
            nextTaskId = await enqueueTask(this.context, {
                queue,
                target: this.task.target,
                task: "dummyPhotos",
                opid: this.task.opid ?? null,
                priority: this.task.priority,
                params: {
                    source,
                    resource,
                    listingId: listing,
                    photoUrls: photos,
                },
            });
            this.context.logger.info?.(
                `[TaskDummyLoad] enqueued dummyPhotos id=${nextTaskId} listingId=${listing} opid=${this.task.opid ?? "none"}`
            );
        }

        return {
            success: true,
            results: {
                source,
                resource,
                recordsCount,
                loaded,
                opid: this.task.opid ?? null,
                nextTask: nextTaskId ? "dummyPhotos" : null,
                nextTaskId,
            },
        };
    }
}
