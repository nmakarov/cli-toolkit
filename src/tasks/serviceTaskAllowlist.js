/**
 * Shared allowlist helpers for task runners: normalize CLI strings, merge with service (control) tasks.
 */

/**
 * Task names every runner should be willing to claim (in addition to `--allowedTasks` or
 * service-group config). These map to core `TasksRegistry.withCoreTasks` handlers.
 */
export const SERVICE_TASK_NAMES = [
    "ping",
    "stop",
    "stopRunner",
    "pause",
    "pauseRunner",
    "unpause",
    "unpauseRunner",
    "pauseTask",
    "resumeTask",
    "shellCommand",
    "systemInfo",
    "info",
    "getLogs",
    "setRuntimeParam",
    "setRunnerParam",
    "pruneTaskRetention",
];

/**
 * Coerce a caller-supplied allowlist value (CLI string, array, or undefined) into
 * a clean string array, or `undefined` when nothing was provided / only blanks.
 *
 *   - `"a,b"`  → `["a", "b"]`
 *   - `["a ", "", " b"]` → `["a", "b"]`
 *   - `"  "` / `undefined` / `null` → `undefined`
 *
 * @param {unknown} value
 * @returns {string[] | undefined}
 */
export function normalizeAllowedTasks(value) {
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
 * Union of `SERVICE_TASK_NAMES` and caller-provided names (deduped, sorted).
 * Use when building the allowlist for `runTasksLoop` / `claimNextRunnableTask`.
 *
 * @param {string[]} [names]
 * @returns {string[]}
 */
export function mergeAllowedTasksWithServiceTasks(names) {
    const set = new Set([...SERVICE_TASK_NAMES, ...(names ?? [])]);
    return Array.from(set).sort();
}
