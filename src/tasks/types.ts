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
    /**
     * When set, registers this process in `{queue}_services_registry` (PostgreSQL) for discovery, naming, and liveness.
     * Example groups: `intake`, `loader`, `photos`, `harvest`.
     */
    runnerServiceGroup?: string;
    /** Optional fixed name; otherwise derived from hostname / group and unique suffix. */
    runnerServiceName?: string;
    /** Directory for per-queue+group identity JSON (stable instance_id + service_name). */
    runnerIdentityDir?: string;
    /** How often to bump `last_seen_at` in `{queue}_services_registry` while the runner loop is active. */
    runnerHeartbeatIntervalMs?: number;
    /** Peers with last_seen older than this are not counted toward group max instances. */
    runnerHeartbeatStaleMs?: number;
    /** Max concurrent alive runners in this group (0 = unlimited). Overrides built-in defaults per group when set. */
    runnerGroupMaxInstances?: number;
    /** If true, exit when group max is reached; if false, log a warning only. */
    runnerEnforceMaxInstances?: boolean;
    /** Stored in services_registry row metadata (JSON). Update at runtime via `updateServicesRegistryMetadata`. */
    runnerMetadata?: Record<string, unknown> | null;
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
    runnerServiceGroup?: string;
    runnerServiceName?: string;
    runnerIdentityDir?: string;
    runnerHeartbeatIntervalMs?: number;
    runnerHeartbeatStaleMs?: number;
    runnerGroupMaxInstances?: number;
    runnerEnforceMaxInstances?: boolean;
    runnerMetadata?: Record<string, unknown> | null;
}
