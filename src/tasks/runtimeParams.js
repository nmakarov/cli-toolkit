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
    "progressWithRate",
    "progressThrottleMs",
];

/**
 * Declared knobs operators may edit via setRuntimeParam / tasksmm "Change param(s)".
 * Written into services_registry `metadata.runtimeParams` at registration.
 *
 * @typedef {{
 *   key: string,
 *   type: "number" | "boolean" | "string",
 *   label: string,
 *   description?: string,
 * }} RuntimeParamSpec
 */

/** @type {RuntimeParamSpec[]} */
export const DEFAULT_RUNTIME_PARAM_SPECS = [
    {
        key: "maxParallel",
        type: "number",
        label: "Max parallel",
        description: "Worker-lane concurrency (how many tasks claim at once)",
    },
    {
        key: "pollMs",
        type: "number",
        label: "Poll ms",
        description: "Idle poll interval between claim attempts",
    },
    {
        key: "claimJitterMs",
        type: "number",
        label: "Claim jitter ms",
        description: "Random delay before worker claims (0 = off)",
    },
    {
        key: "scanLimit",
        type: "number",
        label: "Scan limit",
        description: "Max idle rows scanned per claim attempt",
    },
];

/**
 * Normalize / merge runner-supplied specs with defaults (by key; extras append).
 *
 * @param {RuntimeParamSpec[] | undefined | null} [extra]
 * @returns {RuntimeParamSpec[]}
 */
export function mergeRuntimeParamSpecs(extra) {
    const byKey = new Map(DEFAULT_RUNTIME_PARAM_SPECS.map((s) => [s.key, { ...s }]));
    if (Array.isArray(extra)) {
        for (const raw of extra) {
            if (!raw || typeof raw !== "object") continue;
            const key = String(raw.key ?? "").trim();
            if (!key) continue;
            const prev = byKey.get(key) ?? {};
            const type = ["number", "boolean", "string"].includes(raw.type) ? raw.type : prev.type ?? "string";
            byKey.set(key, {
                key,
                type,
                label: String(raw.label ?? prev.label ?? key),
                description:
                    raw.description != null
                        ? String(raw.description)
                        : prev.description != null
                          ? String(prev.description)
                          : undefined,
            });
        }
    }
    return Array.from(byKey.values());
}

/**
 * Snapshot current values for the given specs from `context.tasksRuntime`.
 *
 * @param {object} context
 * @param {RuntimeParamSpec[]} [specs]
 * @returns {Record<string, unknown>}
 */
export function runtimeValuesForSpecs(context, specs = DEFAULT_RUNTIME_PARAM_SPECS) {
    const rt = ensureTasksRuntime(context);
    const out = {};
    for (const s of specs) {
        if (rt[s.key] !== undefined) out[s.key] = rt[s.key];
    }
    return out;
}

/**
 * Parse specs from registry metadata (tolerant of older runners).
 *
 * @param {unknown} metadata
 * @returns {RuntimeParamSpec[]}
 */
export function runtimeParamSpecsFromMetadata(metadata) {
    const meta = metadata && typeof metadata === "object" ? metadata : null;
    const raw = meta?.runtimeParams;
    if (!Array.isArray(raw) || raw.length === 0) {
        return mergeRuntimeParamSpecs();
    }
    return mergeRuntimeParamSpecs(raw);
}

const CONTROL_LANE_TASK_NAMES = [
    "stopRunner",
    "stop",
    "pauseRunner",
    "pause",
    "unpauseRunner",
    "unpause",
    "pauseTask",
    "resumeTask",
    "setRuntimeParam",
    "setRunnerParam",
];

/**
 * Task names claimed on the dedicated control lane (even when workers are saturated).
 * Pass `extra` from `runTasksLoop({ controlLaneTasks })` for app-specific ops
 * probes (e.g. v2 `hostInfo`) that must run while regular workers are full.
 *
 * @param {string|string[]|undefined|null} [extra]
 * @returns {string[]}
 */
export function controlLaneTaskNames(extra) {
    const names = [...CONTROL_LANE_TASK_NAMES];
    if (extra == null || extra === "") return names;
    const more = Array.isArray(extra) ? extra : String(extra).split(",");
    const seen = new Set(names);
    for (const raw of more) {
        const n = String(raw ?? "").trim();
        if (!n || seen.has(n)) continue;
        seen.add(n);
        names.push(n);
    }
    return names;
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
        case "progressWithRate":
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
 * @param {Partial<{ maxParallel: number, pollMs: number, claimJitterMs: number, scanLimit: number, paused: boolean }>} [seed]
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
    if (rt.paused === undefined) rt.paused = seed.paused === true;
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
            // Prefer specs declared at loop start (also in registry metadata.runtimeParams).
            const specs = Array.isArray(context.tasksRuntimeParamSpecs)
                ? context.tasksRuntimeParamSpecs
                : DEFAULT_RUNTIME_PARAM_SPECS;
            const runtimeSnapshot = runtimeValuesForSpecs(context, specs);
            for (const lk of LOOP_RUNTIME_KEYS) {
                if (runtime[lk] !== undefined && runtimeSnapshot[lk] === undefined) {
                    runtimeSnapshot[lk] = runtime[lk];
                }
            }
            await updateServicesRegistryMetadata(context, reg, {
                runtime: runtimeSnapshot,
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
