import type { Context } from "../init/types.js";

export interface TaskRow {
    id: string;
    created_at: Date | string;
    started_at: Date | string | null;
    completed_at: Date | string | null;
    priority: number;
    schedule: string | null;
    next_run_at: Date | string | null;
    past_due: Date | string | null;
    name: string;
    params: Record<string, any> | null;
    opid: string | null;
    service_group: string | null;
    instance_number: number | null;
    service_name: string | null;
    server_name: string | null;
    status: string;
    status_changed_at: Date | string | null;
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
    queueName?: string;
    recreate?: boolean;
}

export interface EnqueueTaskOptions {
    queueName?: string;
    /** Task handler key (DB column `name`). */
    name?: string;
    /** @deprecated Use `name` */
    task?: string;
    params?: Record<string, any> | null;
    opid?: string | null;
    priority?: number;
    schedule?: string | null;
    /** Stored as `next_run_at`. If omitted while `schedule` is set, the next fire time is computed (see `nextTimeMatch` in `time-matcher`). */
    nextRunAt?: Date | string | null;
    serviceGroup?: string | null;
    instanceNumber?: number | null;
    serviceName?: string | null;
    serverName?: string | null;
}

export interface RunTasksLoopOptions {
    queueName?: string;
    /**
     * Service group this runner claims tasks for (must match `tasks.service_group` on queued rows).
     * Same value is typically passed as `runnerServiceGroup` for registry registration.
     */
    target: string;
    pollMs?: number;
    /**
     * Uniform random delay 0..claimJitterMs (ms) once per poll cycle before claiming normal tasks (not stop).
     * Desynchronizes multiple workers so they don't always race the same rows. 0 disables.
     */
    claimJitterMs?: number;
    maxParallel?: number;
    scanLimit?: number;
    allowedTasks?: string[] | string;
    registry?: any;
    /**
     * When set, registers this process in `{queue}_services_registry` (PostgreSQL) for discovery, naming, and liveness.
     * Example groups: `intake`, `loader`, `photos`, `harvest`.
     */
    runnerServiceGroup?: string;
    /** Explicit fixed service name; otherwise `{group}-{hostname}-{instance}`. */
    runnerServiceName?: string;
    /**
     * Optional fixed instance slot; must be free. If omitted, the first free slot is taken from the registry.
     * Stamped onto claimed task rows together with the allocated `service_name`.
     */
    runnerInstanceNumber?: number;
    /** How often to bump `last_seen_at` in `{queue}_services_registry` while the runner loop is active. */
    runnerHeartbeatIntervalMs?: number;
    /** Peers with last_seen older than this are not counted toward group max instances. */
    runnerHeartbeatStaleMs?: number;
    /** Max concurrent alive runners in this group (0 = unlimited). Overrides built-in defaults per group when set. */
    runnerGroupMaxInstances?: number;
    /** If true (default), refuse to start when over limit; if false, only warn. */
    runnerEnforceMaxInstances?: boolean;
    /** Stored in services_registry row metadata (JSON). Update at runtime via `updateServicesRegistryMetadata`. */
    runnerMetadata?: Record<string, unknown> | null;
}

export interface WaitForTaskResultOptions {
    queueName?: string;
    timeoutMs?: number;
    pollMs?: number;
}

export interface TasksManagerInitOptions {
    queueName?: string;
    target?: string;
    recreateTaskTables?: boolean;
    pollMs?: number;
    claimJitterMs?: number;
    maxParallel?: number;
    scanLimit?: number;
    allowedTasks?: string[] | string;
    registry?: any;
    runnerServiceGroup?: string;
    runnerServiceName?: string;
    runnerInstanceNumber?: number;
    runnerHeartbeatIntervalMs?: number;
    runnerHeartbeatStaleMs?: number;
    runnerGroupMaxInstances?: number;
    runnerEnforceMaxInstances?: boolean;
    runnerMetadata?: Record<string, unknown> | null;
}
