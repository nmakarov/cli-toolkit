import type { TaskResult } from "../types.js";
import { AbstractTask } from "../AbstractTask.js";

export class TaskPing extends AbstractTask {
    async run(): Promise<TaskResult> {
        this.context.logger.info?.(`[TaskPing] pong (${this.task.id})`);
        return { success: true, results: "pong" };
    }
}
