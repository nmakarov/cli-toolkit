/**
 * Shared allowlist helpers for task runners: normalize CLI strings, merge with service (control) tasks.
 */

/**
 * Task names every runner should be willing to claim (in addition to `--allowedTasks` or
 * service-group config). These map to core {@link TasksRegistry.withCoreTasks} handlers.
 */
export const SERVICE_TASK_NAMES = [
    "ping",
    "stop",
    "stopRunner",
    "shellCommand",
    "systemInfo",
    "info",
    "getLogs",
] as const;

export function normalizeAllowedTasks(value: string[] | string | undefined): string[] | undefined {
    if (!value) return undefined;
    if (Array.isArray(value)) {
        const out = value.map((v) => String(v).trim()).filter(Boolean);
        return out.length ? out : undefined;
    }
    const out = String(value)
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
    return out.length ? out : undefined;
}

/**
 * Union of {@link SERVICE_TASK_NAMES} and caller-provided names (deduped, sorted).
 * Use when building the allowlist for `runTasksLoop` / `claimNextRunnableTask`.
 */
export function mergeAllowedTasksWithServiceTasks(names: string[] | undefined): string[] {
    const set = new Set<string>([...SERVICE_TASK_NAMES, ...(names ?? [])]);
    return Array.from(set).sort();
}
