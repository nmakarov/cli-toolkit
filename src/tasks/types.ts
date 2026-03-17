import type { Context } from "../init/types.js";

export interface TaskRow {
    id: string;
    created_at: Date | string;
    started_at: Date | string | null;
    completed_at: Date | string | null;
    priority: number;
    schedule: string | null;
    past_due: Date | string | null;
    target: string;
    task: string;
    params: Record<string, any> | null;
    opid: string | null;
    paused_at?: Date | string | null;
    progress: string | null;
    success: boolean | null;
    results: any;
}

export interface TaskResult {
    success: boolean;
    results?: any;
}

export interface TaskInstance {
    cantRunReason?: () => string | false | null | Promise<string | false | null>;
    requestStop?: (allowanceMs: number) => void | Promise<void>;
    run: (reportProgress: (progress: any) => Promise<void>) => Promise<TaskResult>;
}

export type TaskClass = new (context: Context, task: TaskRow) => TaskInstance;
export type TasksRegistryMap = Record<string, TaskClass>;

export interface EnsureTaskTablesOptions {
    queue?: string;
    recreate?: boolean;
}

export interface EnqueueTaskOptions {
    queue?: string;
    target: string;
    task: string;
    params?: Record<string, any> | null;
    opid?: string | null;
    priority?: number;
    schedule?: string | null;
}

export interface RunTasksLoopOptions {
    queue?: string;
    target: string;
    pollMs?: number;
    maxParallel?: number;
    scanLimit?: number;
    allowedTasks?: string[] | string;
    registry?: any;
}

export interface WaitForTaskResultOptions {
    queue?: string;
    timeoutMs?: number;
    pollMs?: number;
}

export interface TasksManagerInitOptions {
    queue?: string;
    target?: string;
    recreateTaskTables?: boolean;
    pollMs?: number;
    maxParallel?: number;
    scanLimit?: number;
    allowedTasks?: string[] | string;
    registry?: any;
}
