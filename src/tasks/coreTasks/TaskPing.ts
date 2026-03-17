import type { TaskResult } from "../types.js";
import { TaskMaster } from "../TaskMaster.js";

export class TaskPing extends TaskMaster {
    async run(): Promise<TaskResult> {
        this.context.logger.info?.(`[TaskPing] pong (${this.task.id})`);
        return { success: true, results: "pong" };
    }
}
