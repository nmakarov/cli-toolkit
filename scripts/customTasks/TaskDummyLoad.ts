import path from "node:path";
import { fileURLToPath } from "node:url";
import { AbstractTask } from "../../src/tasks/AbstractTask.js";
import { enqueueTask } from "../../src/tasks/taskUtils.js";
import { runNodeTaskScript } from "../../src/tasks/index.js";
import type { TaskResult } from "../../src/tasks/types.js";
import { getQueueTableName } from "./dummyTaskRuntime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOAD_WORKER_SCRIPT = path.join(__dirname, "dummy-load-worker.ts");

function shellQuote(value: string): string {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export class TaskDummyLoad extends AbstractTask {
    async run(reportProgress: (progress: any) => Promise<void>): Promise<TaskResult> {
        const queueName = getQueueTableName(this.context);
        const p = (this.task.params ?? {}) as Record<string, unknown>;

        const source = String(p.source ?? "").trim();
        const resource = String(p.resource ?? "").trim();
        const opid = (this.task.opid ?? (typeof p.opid === "string" ? p.opid : "")).toString().trim();
        const recordsCount = Math.max(1, Math.floor(Number(p.recordsCount) || 100));
        const loadDelayMs = Math.max(0, Number(p.loadDelayMs) || 150);
        const batchSize = Math.max(1, Number(p.batchSize) || 25);
        const loadErrorChance = Math.min(1, Math.max(0, Number(p.loadErrorChance) || 0));

        if (!source || !resource) {
            return {
                success: false,
                results: { message: 'dummyLoad requires params "source" and "resource"' },
            };
        }

        if (this.context.db == null) {
            return {
                success: false,
                results: { message: "context.db is required for dummyLoad" },
            };
        }

        const run = await runNodeTaskScript(this.context, {
            scriptPath: LOAD_WORKER_SCRIPT,
            task: this.task,
            onProgress: reportProgress,
            args: [
                `--source=${source}`,
                `--resource=${resource}`,
                `--recordsCount=${recordsCount}`,
                `--loadDelayMs=${loadDelayMs}`,
                `--batchSize=${batchSize}`,
                `--loadErrorChance=${loadErrorChance}`,
                ...(opid ? [`--opid=${opid}`] : []),
                `--queueName=${queueName}`,
                `--dbName=${String(this.context.params?.get?.("dbName") || "local")}`,
            ],
        });

        const dbName = String(this.context.params?.get?.("dbName") || "local");
        const rerunCommand = [
            "npx",
            "tsx",
            "scripts/customTasks/dummy-load-worker.ts",
            `--dbName=${shellQuote(dbName)}`,
            `--queueName=${shellQuote(queueName)}`,
            `--source=${shellQuote(source)}`,
            `--resource=${shellQuote(resource)}`,
            `--recordsCount=${recordsCount}`,
            `--syncTaskRow=true`,
            `--taskId=${shellQuote(this.task.id)}`,
        ].join(" ");

        const loadedRaw = run.workerResult?.loaded;
        const hasValid = Number.isFinite(Number(loadedRaw));
        if (run.exitCode !== 0 || run.hadErrorMessage || !hasValid) {
            this.context.logger.error?.(`[TaskDummyLoad] failed ${source}/${resource}. Retry: ${rerunCommand}`);
            return {
                success: false,
                results: {
                    error: "dummy-load-worker failed",
                    exitCode: run.exitCode,
                    hadErrorMessage: run.hadErrorMessage,
                    stderr: run.stderr,
                    opid,
                    rerunCommand,
                },
            };
        }

        const loaded = Number(loadedRaw);

        if (resource.toLowerCase() === "properties") {
            await enqueueTask(this.context, {
                queueName,
                name: "dummyPhotos",
                opid: opid || null,
                priority: this.task.priority ?? 50,
                params: { source, resource, listingId: p.listingId ?? null, photoUrls: p.photoUrls ?? [] },
                serviceGroup: null,
            });
        }

        return {
            success: true,
            results: {
                message: "dummyLoad complete",
                opid,
                source,
                resource,
                loaded,
                enqueued: resource.toLowerCase() === "properties" ? "dummyPhotos" : null,
            },
        };
    }
}
