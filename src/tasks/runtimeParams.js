import { ParamError } from "../errors.js";
import { updateServicesRegistryMetadata } from "./servicesRegistry.js";

/** Keys the tasks loop re-reads every tick from `context.tasksRuntime`. */
export const LOOP_RUNTIME_KEYS = ["maxParallel", "pollMs", "claimJitterMs", "scanLimit"];

/** Keys applied via `context.logger.configure(...)`. */
export const LOGGER_RUNTIME_KEYS = [
    "levels",
    "silent",
    "showLevel",
    "timestamp",
    "mode",
    "route",
    "prefix",
    "progressWithTimes",
    "progressThrottleMs",
];

const CONTROL_LANE_TASK_NAMES = ["stopRunner", "stop", "setRuntimeParam", "setRunnerParam"];

/**
 * Task names claimed on the dedicated control lane (even when workers are saturated).
 * @returns {string[]}
 */
export function controlLaneTaskNames() {
    return [...CONTROL_LANE_TASK_NAMES];
}

/**
 * @param {unknown} value
 * @param {string} key
 * @returns {number}
 */
function asPositiveInt(value, key, { min = 1 } = {}) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < min) {
        throw new ParamError(
            `setRuntimeParam: ${key} must be a number >= ${min} (got ${JSON.stringify(value)})`
        );
    }
    return Math.floor(n);
}

/**
 * Coerce / validate a single runtime value for a known key.
 * Unknown keys pass through unchanged (apps may handle via onRuntimeParam).
 *
 * @param {string} key
 * @param {unknown} value
 * @returns {unknown}
 */
export function coerceRuntimeValue(key, value) {
    switch (key) {
        case "maxParallel":
            return asPositiveInt(value, key, { min: 1 });
        case "pollMs":
            return asPositiveInt(value, key, { min: 50 });
        case "claimJitterMs":
            return asPositiveInt(value, key, { min: 0 });
        case "scanLimit":
            return asPositiveInt(value, key, { min: 1 });
        case "silent":
        case "showLevel":
        case "timestamp":
        case "progressWithTimes":
            if (typeof value === "boolean") return value;
            if (value === "true" || value === "1") return true;
            if (value === "false" || value === "0") return false;
            throw new ParamError(
                `setRuntimeParam: ${key} must be boolean (got ${JSON.stringify(value)})`
            );
        case "progressThrottleMs":
            return asPositiveInt(value, key, { min: 0 });
        case "levels":
        case "mode":
        case "route":
        case "prefix":
            return value;
        default:
            return value;
    }
}

/**
 * Ensure `context.tasksRuntime` exists (used by the loop and by setRuntimeParam).
 *
 * @param {object} context
 * @param {Partial<{ maxParallel: number, pollMs: number, claimJitterMs: number, scanLimit: number }>} [seed]
 * @returns {Record<string, unknown>}
 */
export function ensureTasksRuntime(context, seed = {}) {
    if (!context.tasksRuntime || typeof context.tasksRuntime !== "object") {
        context.tasksRuntime = {};
    }
    const rt = context.tasksRuntime;
    if (rt.maxParallel === undefined) rt.maxParallel = seed.maxParallel ?? 32;
    if (rt.pollMs === undefined) rt.pollMs = seed.pollMs ?? 1000;
    if (rt.claimJitterMs === undefined) rt.claimJitterMs = seed.claimJitterMs ?? 0;
    if (rt.scanLimit === undefined) rt.scanLimit = seed.scanLimit ?? 100;
    return rt;
}

/**
 * Apply one key/value to the running process. Mutates `context.tasksRuntime`,
 * updates logger when relevant, invokes optional `context.tasksRuntimeOnParam`.
 *
 * @param {object} context
 * @param {string} key
 * @param {unknown} value
 * @returns {Promise<{ key: string, previous: unknown, next: unknown, applied: string[] }>}
 */
export async function applyRuntimeParam(context, key, value) {
    const k = String(key ?? "").trim();
    if (!k) throw new ParamError("setRuntimeParam: key is required");

    const runtime = ensureTasksRuntime(context);
    const next = coerceRuntimeValue(k, value);
    const previous = runtime[k];
    const applied = [];

    runtime[k] = next;
    applied.push("tasksRuntime");

    if (LOGGER_RUNTIME_KEYS.includes(k) && context.logger?.configure) {
        context.logger.configure({ [k]: next });
        applied.push("logger");
    }

    const hook = context.tasksRuntimeOnParam;
    if (typeof hook === "function") {
        await hook(k, next, runtime, context);
        applied.push("onRuntimeParam");
    }

    const reg = context.servicesRegistry;
    if (reg?.rowId && reg?.registryTable) {
        try {
            const loopSnapshot = {};
            for (const lk of LOOP_RUNTIME_KEYS) {
                if (runtime[lk] !== undefined) loopSnapshot[lk] = runtime[lk];
            }
            await updateServicesRegistryMetadata(context, reg, {
                runtime: loopSnapshot,
                runtimeUpdatedAt: new Date().toISOString(),
            });
            applied.push("servicesRegistry");
        } catch (err) {
            context.logger?.warn?.(
                `[setRuntimeParam] registry metadata update failed: ${err?.message ?? String(err)}`
            );
        }
    }

    return { key: k, previous, next, applied };
}

/**
 * Apply a patch object `{ key: value, ... }` sequentially.
 *
 * @param {object} context
 * @param {Record<string, unknown>} patch
 * @returns {Promise<Array<{ key: string, previous: unknown, next: unknown, applied: string[] }>>}
 */
export async function applyRuntimePatch(context, patch) {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
        throw new ParamError("setRuntimeParam: patch must be a plain object");
    }
    const entries = Object.entries(patch);
    if (entries.length === 0) {
        throw new ParamError("setRuntimeParam: patch is empty");
    }
    const out = [];
    for (const [key, value] of entries) {
        out.push(await applyRuntimeParam(context, key, value));
    }
    return out;
}

/**
 * Read loop knobs from `context.tasksRuntime` with sane clamps.
 *
 * @param {object} context
 * @returns {{ maxParallel: number, pollMs: number, claimJitterMs: number, scanLimit: number }}
 */
export function readLoopRuntime(context) {
    const rt = ensureTasksRuntime(context);
    return {
        maxParallel: Math.max(1, Number(rt.maxParallel) || 1),
        pollMs: Math.max(50, Number(rt.pollMs) || 1000),
        claimJitterMs: Math.max(0, Number(rt.claimJitterMs) || 0),
        scanLimit: Math.max(1, Number(rt.scanLimit) || 100),
    };
}
