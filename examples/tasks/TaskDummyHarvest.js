import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { enqueueTask, runNodeTaskScript } from "../../src/tasks/index.js";
import { TaskMaster } from "../../src/tasks/TaskMaster.js";

import { countRunningHarvestForSource, countUnfinishedLoadForPair, ensureTaskOpid, getQueueTableName } from "./dummyTaskRuntime.js";

function toPositiveInt(value, fallback) {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) return fallback;
    return n;
}

function shellQuote(value) {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export class TaskDummyHarvest extends TaskMaster {
    async cantRunReason() {
        const sourceRaw = this.task?.params?.source;
        const resourceRaw = this.task?.params?.resource;
        const source = typeof sourceRaw === "string" ? sourceRaw.trim() : "";
        const resource = typeof resourceRaw === "string" ? resourceRaw.trim() : "";
        if (!source) return "missing source";
        if (!resource) return "missing resource";
        const running = await countRunningHarvestForSource(this.context, this.task, source);
        if (running > 0) {
            return "locked by source";
        }
        const unfinishedLoad = await countUnfinishedLoadForPair(this.context, source, resource);
        if (unfinishedLoad > 0) {
            return "locked by loader";
        }
        return false;
    }

    async run(reportProgress) {
        const sourceRaw = this.task?.params?.source;
        const resourceRaw = this.task?.params?.resource;
        const source = typeof sourceRaw === "string" ? sourceRaw.trim() : "";
        const resource = typeof resourceRaw === "string" ? resourceRaw.trim() : "";
        const minRecords = toPositiveInt(this.task?.params?.minRecords, 50);
        const maxRecords = toPositiveInt(this.task?.params?.maxRecords, 500);
        const delayMs = toPositiveInt(this.task?.params?.delayMs, 200);
        const batchSize = toPositiveInt(this.task?.params?.batchSize, 25);
        const loadDelayMs = toPositiveInt(this.task?.params?.loadDelayMs, 150);
        const harvestErrorChance = Number(this.task?.params?.harvestErrorChance ?? 0);
        const loadErrorChance = Number(this.task?.params?.loadErrorChance ?? 0);

        if (!source || !resource) {
            return {
                success: false,
                results: {
                    error: 'Validation failed: "source" and "resource" are required',
                    received: this.task?.params ?? null,
                },
            };
        }

        if (minRecords > maxRecords) {
            return {
                success: false,
                results: {
                    error: `Validation failed: minRecords (${minRecords}) must be <= maxRecords (${maxRecords})`,
                },
            };
        }

        const opid = this.task.opid || `op_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
        this.task.opid = opid;
        await ensureTaskOpid(this.context, this.task, opid);

        const scriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "scripts", "dummy-harvest-worker.ts");
        const run = await runNodeTaskScript(this.context, {
            scriptPath,
            task: this.task,
            onProgress: reportProgress,
            args: [
                `--source=${source}`,
                `--resource=${resource}`,
                `--minRecords=${minRecords}`,
                `--maxRecords=${maxRecords}`,
                `--delayMs=${delayMs}`,
                `--batchSize=${batchSize}`,
                `--harvestErrorChance=${harvestErrorChance}`,
                `--opid=${opid}`,
            ],
        });

        const dbName = String((this.context )?.params?.get?.("dbName") || "local");
        const tableName = String((this.context )?.params?.get?.("table") || "tasks");
        const rerunCommand = [
            "npx",
            "tsx",
            "examples/tasks/recover-task.ts",
            `--dbName=${shellQuote(dbName)}`,
            `--table=${shellQuote(tableName)}`,
            `--id=${shellQuote(this.task.id)}`,
        ].join(" ");

        const fetchedRaw = run.workerResult?.fetched;
        const hasValidResult = Number.isFinite(Number(fetchedRaw));
        if (run.exitCode !== 0 || run.hadErrorMessage || !hasValidResult) {
            this.context.logger.error?.(
                `[TaskDummyHarvest] failed for ${source}/${resource}. Once fixed, rerun standalone worker: ${rerunCommand}`
            );
            return {
                success: false,
                results: {
                    error: "dummy-harvest-worker failed",
                    exitCode: run.exitCode,
                    hadErrorMessage: run.hadErrorMessage,
                    hasValidWorkerResult: hasValidResult,
                    stderr: run.stderr,
                    stdout: run.stdout,
                    opid,
                    rerunCommand,
                    rerunHint: `Once problem is fixed, you can re-run this task by running: ${rerunCommand}. This queue-aware recovery will update task progress/status and enqueue dummyLoad automatically if successful.`,
                },
            };
        }

        const fetched = Number(fetchedRaw);
        const listingId = run.workerResult?.listingId ?? null;
        const photoUrls = Array.isArray(run.workerResult?.photoUrls) ? run.workerResult.photoUrls : [];
        const table = getQueueTableName(this.context);

        const loadTaskId = await enqueueTask(this.context, {
            queue: table,
            target: this.task.target,
            task: "dummyLoad",
            opid,
            priority: this.task.priority,
            params: {
                source,
                resource,
                recordsCount: fetched,
                listingId,
                photoUrls,
                loadDelayMs,
                loadErrorChance,
            },
        });

        this.context.logger.info?.(
            `[TaskDummyHarvest] done source=${source} resource=${resource} fetched=${fetched} opid=${opid}, enqueued dummyLoad=${loadTaskId}`
        );

        return {
            success: true,
            results: {
                source,
                resource,
                fetched,
                opid,
                nextTask: "dummyLoad",
                nextTaskId: loadTaskId,
                listingId,
            },
        };
    }
}
