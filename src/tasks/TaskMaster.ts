import type { Context } from "../init/types.js";
import type { TaskResult, TaskRow } from "./types.js";

export abstract class TaskMaster {
    protected context: Context;
    protected task: TaskRow;

    constructor(context: Context, task: TaskRow) {
        this.context = context;
        this.task = task;
    }

    cantRunReason(): string | false | null | Promise<string | false | null> {
        return false;
    }

    requestStop(_allowanceMs: number): void {
        // Default no-op; long-running tasks can override.
    }

    abstract run(reportProgress: (progress: any) => Promise<void>): Promise<TaskResult>;
}
