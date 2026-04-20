import type { TaskResult } from "../types.js";
import { AbstractTask } from "../AbstractTask.js";

export class TaskStopRunner extends AbstractTask {
    async run(): Promise<TaskResult> {
        const allowanceMs = Number(this.task?.params?.allowanceMs ?? 5000);
        this.context.logger.warn?.(`[TaskStopRunner] stop requested (allowanceMs=${allowanceMs})`);
        return {
            success: true,
            results: {
                stopRunner: true,
                allowanceMs,
                message: "Runner stop requested",
            },
        };
    }
}
