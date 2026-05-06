import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { ParamError } from "../../src/errors.js";
import { AbstractTask } from "../../src/tasks/AbstractTask.js";
import {
    ipcFileLogsTableNameForSourceResource,
    runNodeTaskScript,
} from "../../src/tasks/index.js";
// import { enqueueTask } from "../../src/tasks/taskUtils.js"; // re-enable when scheduling dummyLoad
import {
    countRunningHarvestForSource,
    // countUnfinishedLoadForPair, // re-enable with cantRunReason loader lock
    ensureTaskOpid,
    getQueueTableName,
} from "./dummyTaskRuntime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HARVEST_WORKER_SCRIPT = path.join(__dirname, "dummy-harvest-worker.js");

function toPositiveInt(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.floor(n);
}

function clampUnit(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.min(1, Math.max(0, n));
}

function shellQuote(value) {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export class TaskDummyHarvest extends AbstractTask {
    /**
     * @param {object} context
     * @param {Record<string, unknown>} [overrides]
     * @returns {Promise<object>}
     */
    static async resolveCustomParams(context, overrides = {}) {
        const merged = AbstractTask._mergeTypedParams(context, "task-dummy-harvest", {
            source: "string",
            resource: "string",
            minRecords: "number default 50",
            maxRecords: "number default 500",
            delayMs: "number default 200",
            batchSize: "number default 25",
            loadDelayMs: "number default 150",
            harvestErrorChance: "number default 0",
            loadErrorChance: "number default 0",
        }, overrides);

        const source = typeof merged.source === "string" ? merged.source.trim() : "";
        const resource = typeof merged.resource === "string" ? merged.resource.trim() : "";
        if (!source) throw new ParamError('dummyHarvest: param "source" is required');
        if (!resource) throw new ParamError('dummyHarvest: param "resource" is required');

        const minRecords = toPositiveInt(merged.minRecords, 50);
        const maxRecords = toPositiveInt(merged.maxRecords, 500);
        if (minRecords > maxRecords) {
            throw new ParamError(
                `dummyHarvest: minRecords (${minRecords}) must be <= maxRecords (${maxRecords})`
            );
        }

        return {
            source,
            resource,
            minRecords,
            maxRecords,
            delayMs: Math.max(0, Math.floor(Number(merged.delayMs) || 200)),
            batchSize: toPositiveInt(merged.batchSize, 25),
            loadDelayMs: Math.max(0, Math.floor(Number(merged.loadDelayMs) || 150)),
            harvestErrorChance: clampUnit(merged.harvestErrorChance),
            loadErrorChance: clampUnit(merged.loadErrorChance),
        };
    }

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
        // Re-enable when dummyLoad is scheduled again: block harvest while a load for this pair is unfinished.
        // const unfinishedLoad = await countUnfinishedLoadForPair(this.context, source, resource);
        // if (unfinishedLoad > 0) {
        //     return "locked by loader";
        // }
        return false;
    }

    async run(reportProgress) {
        const queueName = getQueueTableName(this.context);
        const db = this.context.db;
        const p = this.task.params ?? {};

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
        const tasksLogsBasePath = params?.get?.("tasksLogsBasePath") ?? "./data";
        const tasksLogsNamespace = params?.get?.("tasksLogsNamespace") ?? "tasks-logs";

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
            "scripts/customTasks/dummy-harvest-worker.js",
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
