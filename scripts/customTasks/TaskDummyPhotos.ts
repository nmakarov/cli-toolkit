import { sleepMs } from "../../src/utils/index.js";
import { AbstractTask } from "../../src/tasks/AbstractTask.js";
import type { TaskResult } from "../../src/tasks/types.js";

export class TaskDummyPhotos extends AbstractTask {
    async run(reportProgress: (progress: any) => Promise<void>): Promise<TaskResult> {
        const p = (this.task.params ?? {}) as Record<string, unknown>;
        const source = String(p.source ?? "");
        const resource = String(p.resource ?? "");
        const opid = this.task.opid ?? null;

        const steps = 5;
        const delayMs = 80;
        for (let i = 1; i <= steps; i += 1) {
            await reportProgress({
                phase: "photos",
                source,
                resource,
                step: i,
                total: steps,
                opid,
            });
            await sleepMs(delayMs);
        }

        return {
            success: true,
            results: {
                message: "dummyPhotos complete",
                opid,
                source,
                resource,
            },
        };
    }
}
