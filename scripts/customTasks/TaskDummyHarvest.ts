import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { AbstractTask } from "../../src/tasks/AbstractTask.js";
import {
    ipcFileLogsTableNameForSourceResource,
    runNodeTaskScript,
} from "../../src/tasks/index.js";
// import { enqueueTask } from "../../src/tasks/taskUtils.js"; // re-enable when scheduling dummyLoad
import type { TaskResult } from "../../src/tasks/types.js";
import {
    countRunningHarvestForSource,
    // countUnfinishedLoadForPair, // re-enable with cantRunReason loader lock
    ensureTaskOpid,
    getQueueTableName,
} from "./dummyTaskRuntime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HARVEST_WORKER_SCRIPT = path.join(__dirname, "dummy-harvest-worker.ts");

function toPositiveInt(value: unknown, fallback: number): number {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) return fallback;
    return n;
}

function shellQuote(value: string): string {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export class TaskDummyHarvest extends AbstractTask {
    async cantRunReason(): Promise<string | false> {
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
        // Re-enable when dummyLoad is scheduled again: block harvest while a load for this pair is unfinished.
        // const unfinishedLoad = await countUnfinishedLoadForPair(this.context, source, resource);
        // if (unfinishedLoad > 0) {
        //     return "locked by loader";
        // }
        return false;
    }

    async run(reportProgress: (progress: any) => Promise<void>): Promise<TaskResult> {
        const queueName = getQueueTableName(this.context);
        const db = this.context.db;
        const p = (this.task.params ?? {}) as Record<string, unknown>;

        const source = String(p.source ?? "").trim();
        const resource = String(p.resource ?? "").trim();
        const minRecords = toPositiveInt(p.minRecords, 50);
        const maxRecords = toPositiveInt(p.maxRecords, 500);
        const delayMs = toPositiveInt(p.delayMs, 200);
        const batchSize = toPositiveInt(p.batchSize, 25);
        // const loadDelayMs = toPositiveInt(p.loadDelayMs, 150); // dummyLoad params
        // const loadErrorChance = Number(p.loadErrorChance ?? 0);
        const harvestErrorChance = Number(p.harvestErrorChance ?? 0);

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

        if (db == null) {
            return {
                success: false,
                results: { message: "context.db is required for dummyHarvest" },
            };
        }

        const opid = this.task.opid?.trim() || `op_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
        await ensureTaskOpid(this.context, this.task, opid);

        const params = this.context.params;
        const tasksLogsBasePath = (params?.get?.("tasksLogsBasePath") as string | undefined) ?? "./data";
        const tasksLogsNamespace = (params?.get?.("tasksLogsNamespace") as string | undefined) ?? "tasks-logs";

        const run = await runNodeTaskScript(this.context, {
            scriptPath: HARVEST_WORKER_SCRIPT,
            task: this.task,
            onProgress: reportProgress,
            ipcFileLogs: {
                basePath: tasksLogsBasePath,
                namespace: tasksLogsNamespace,
                tableName: ipcFileLogsTableNameForSourceResource(source, resource),
            },
            args: [
                `--source=${source}`,
                `--resource=${resource}`,
                `--minRecords=${minRecords}`,
                `--maxRecords=${maxRecords}`,
                `--delayMs=${delayMs}`,
                `--batchSize=${batchSize}`,
                `--harvestErrorChance=${harvestErrorChance}`,
                `--opid=${opid}`,
                `--queueName=${queueName}`,
            ],
        });

        const dbName = String(this.context.params?.get?.("dbName") || "local");
        const rerunCommand = [
            "npx",
            "tsx",
            "scripts/customTasks/dummy-harvest-worker.ts",
            `--dbName=${shellQuote(dbName)}`,
            `--queueName=${shellQuote(queueName)}`,
            `--source=${shellQuote(source)}`,
            `--resource=${shellQuote(resource)}`,
            `--syncTaskRow=true`,
            `--taskId=${shellQuote(this.task.id)}`,
        ].join(" ");

        const fetchedRaw = run.workerResult?.fetched;
        const hasValidResult = Number.isFinite(Number(fetchedRaw));
        if (run.exitCode !== 0 || run.hadErrorMessage || !hasValidResult) {
            this.context.logger.error?.(
                `[TaskDummyHarvest] failed for ${source}/${resource}. Standalone retry: ${rerunCommand}`
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
                },
            };
        }

        const fetched = Number(fetchedRaw);
        const listingId = run.workerResult?.listingId ?? null;

        // Re-enable when the pipeline includes loaders (pass listingId, photoUrls, loadDelayMs, loadErrorChance, batchSize):
        // const loadDelayMs = toPositiveInt(p.loadDelayMs, 150);
        // const loadErrorChance = Number(p.loadErrorChance ?? 0);
        // const loadTaskId = await enqueueTask(this.context, { ... });

        return {
            success: true,
            results: {
                source,
                resource,
                fetched,
                opid,
                listingId,
            },
        };
    }
}
