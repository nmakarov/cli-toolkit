import path from "node:path";
import { fileURLToPath } from "node:url";
import { TaskMaster } from "../../src/tasks/TaskMaster.js";
import type { TaskResult } from "../../src/tasks/types.js";
import { runNodeTaskScript } from "../../src/tasks/index.js";
import { countRunningTasksByName, getNumberParam } from "./dummyTaskRuntime.js";

export class TaskDummyPhotos extends TaskMaster {
    async cantRunReason(): Promise<string | false> {
        const limit = getNumberParam(this.context, "dummyPhotosMaxParallel", 5);
        const running = await countRunningTasksByName(this.context, "dummyPhotos");
        if (running >= limit) {
            return `dummyPhotos concurrency limit reached (${running}/${limit})`;
        }
        return false;
    }

    async run(reportProgress: (progress: any) => Promise<void>): Promise<TaskResult> {
        const listingId = typeof this.task?.params?.listingId === "string" ? this.task.params.listingId : "";
        const photoUrls = Array.isArray(this.task?.params?.photoUrls) ? this.task.params.photoUrls : [];
        if (!listingId) {
            return {
                success: false,
                results: { error: 'Validation failed: "listingId" is required', received: this.task?.params ?? null },
            };
        }

        const scriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "scripts", "dummy-photos-worker.ts");
        const run = await runNodeTaskScript(this.context, {
            scriptPath,
            task: this.task,
            onProgress: reportProgress,
            args: [
                `--listingId=${listingId}`,
                `--photoUrlsJson=${JSON.stringify(photoUrls)}`,
                this.task.opid ? `--opid=${this.task.opid}` : "",
            ],
        });

        if (run.exitCode !== 0) {
            return {
                success: false,
                results: {
                    error: "dummy-photos-worker failed",
                    exitCode: run.exitCode,
                    stderr: run.stderr,
                    stdout: run.stdout,
                    opid: this.task.opid ?? null,
                },
            };
        }

        return {
            success: true,
            results: {
                ...run.workerResult,
                opid: this.task.opid ?? null,
                source: this.task?.params?.source ?? null,
                resource: this.task?.params?.resource ?? null,
            },
        };
    }
}
