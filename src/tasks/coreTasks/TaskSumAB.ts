import type { TaskResult } from "../types.js";
import { AbstractTask } from "../AbstractTask.js";

export class TaskSumAB extends AbstractTask {
    async run(): Promise<TaskResult> {
        const a = this.task?.params?.a;
        const b = this.task?.params?.b;

        if (typeof a !== "number" || Number.isNaN(a)) {
            return {
                success: false,
                results: {
                    error: 'Validation failed: param "a" must be a valid number',
                    received: { a, b },
                },
            };
        }

        if (typeof b !== "number" || Number.isNaN(b)) {
            return {
                success: false,
                results: {
                    error: 'Validation failed: param "b" must be a valid number',
                    received: { a, b },
                },
            };
        }

        const sum = a + b;
        this.context.logger.info?.(`[TaskSumAB] ${a} + ${b} = ${sum} (${this.task.id})`);
        return {
            success: true,
            results: { a, b, sum },
        };
    }
}
