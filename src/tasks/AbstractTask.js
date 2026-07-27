import { ParamError } from "../errors.js";

/**
 * Base class every task handler extends. Holds the runner `context` and the
 * claimed task row, and defines the contract the runner calls into:
 *
 *   - {@link AbstractTask#cantRunReason}: synchronous / async precondition check.
 *     Returning a truthy string tells the runner "skip for now, stash the reason
 *     into `progress`" without burning a retry; returning `false` means "go".
 *   - {@link AbstractTask#run}: the actual work, handed a `reportProgress`
 *     callback that updates the DB `progress` column.
 *   - {@link AbstractTask#requestStop}: cooperative shutdown signal from the runner
 *     (noop by default; long-running tasks override to honor it).
 *
 * Static enqueue-time hooks (write-time validation):
 *
 *   - {@link AbstractTask.resolveParams}: build a full row payload (envelope +
 *     inner `params` blob) for {@link enqueueTask}. Subclasses normally do not
 *     override this — they override {@link AbstractTask.resolveCustomParams}
 *     instead. Override here only for envelope-level cross-field rules
 *     (e.g. "stop tasks must target a specific service_name").
 *   - {@link AbstractTask.resolveCustomParams}: validate / default the typed
 *     fields that go into the `params` JSON column. Default returns a
 *     `--paramsJson` passthrough; subclasses override.
 *
 * Both static methods are async and accept `(context, overrides)`. `overrides`
 * is a partial that wins over CLI/env values — the typical caller is the
 * {@link TasksRegistry#resolveTaskParams} dispatcher, which seeds it with
 * `{ name }`. Programmatic enqueuers can pass any envelope field plus
 * `overrides.params` to inject inner-blob values.
 */
export class AbstractTask {
    /**
     * Whether `send-task` should wait for completion (and print a result
     * report) when no explicit `--wait` / `--noWait` flag is given. Defaults
     * to false; short-lived probe tasks (e.g. `ping`) override to true.
     *
     * @type {boolean}
     */
    static defaultWaitForResult = false;

    /**
     * @param {object} context Runner context (db, logger, params, emitter...).
     * @param {object} task    Task row as claimed from the queue.
     */
    constructor(context, task) {
        this.context = context;
        this.task = task;
        /** @type {boolean} */
        this._stopRequested = false;
        /** @type {boolean} */
        this._pauseRequested = false;
    }

    /**
     * Return a short reason string when the task should be deferred (e.g. "locked
     * by source"), or `false`/falsy when it is free to run. Default: always `false`.
     *
     * @returns {string | false | Promise<string | false>}
     */
    cantRunReason() {
        return false;
    }

    /**
     * Called by the runner when a stop has been requested. Subclasses running
     * long loops should flip a flag here and check it between iterations.
     *
     * @param {number} [_allowanceMs] Grace period the runner promises before hard exit.
     */
    requestStop(_allowanceMs) {
        this._stopRequested = true;
    }

    /**
     * Cooperative pause signal (from `pauseTask` control-lane task). Long-running
     * tasks should finish the current unit of work, persist a checkpoint, and
     * return `{ success: true, results: { taskPaused: true, … } }` so the runner
     * keeps the row as `status=paused` instead of deleting it.
     *
     * @param {number} [_allowanceMs]
     */
    requestPause(_allowanceMs) {
        this._pauseRequested = true;
    }

    /** @returns {boolean} */
    isStopRequested() {
        return this._stopRequested === true;
    }

    /** @returns {boolean} */
    isPauseRequested() {
        return this._pauseRequested === true;
    }

    /**
     * Perform the task. Must be implemented by subclasses.
     *
     * @param {(progress: unknown) => Promise<void>} _reportProgress
     *        Updates the DB `progress` column. Accepts any serializable value;
     *        strings are stored verbatim, objects are JSON-stringified.
     * @returns {Promise<{ success: boolean, results: unknown }>}
     */
    async run(_reportProgress) {
        throw new Error("AbstractTask.run must be implemented by subclass");
    }

    /**
     * Resolve a complete row payload for this task — envelope fields (queue,
     * priority, targeting, schedule…) plus the inner `params` blob produced by
     * {@link AbstractTask.resolveCustomParams}. Output shape matches
     * {@link enqueueTask}'s `options` argument, so the typical call is:
     *
     *   const payload = await TaskClass.resolveParams(context, { name });
     *   await enqueueTask(context, payload);
     *
     * Validation failures throw {@link ParamError} so the script aborts before
     * a malformed row hits the DB.
     *
     * @param {object} context
     * @param {Record<string, unknown>} [overrides] Partial overrides; takes precedence over CLI/env.
     *   Recognised keys: `name`, `queueName`, `priority`, `serviceGroup`,
     *   `serviceName`, `instanceNumber`, `serverName`, `opid`, `schedule`,
     *   `nextRunAt`, plus `params` (object — overlay onto inner blob).
     * @returns {Promise<object>}
     */
    static async resolveParams(context, overrides = {}) {
        const main = AbstractTask._resolveMainFields(context, overrides);
        const params = await this.resolveCustomParams(context, overrides);
        return { ...main, params };
    }

    /**
     * Resolve the inner JSON blob stored in the `params` column. Default
     * implementation passes through `--paramsJson` (parsed as a JSON object)
     * overlaid with `overrides.params` when supplied; returns `null` when
     * neither is provided.
     *
     * Subclasses with typed fields should override and call
     * {@link AbstractTask._mergeTypedParams} for layered CLI/env/JSON/override
     * resolution, then validate and throw {@link ParamError} on bad input.
     *
     * @param {object} context
     * @param {Record<string, unknown>} [overrides]
     * @returns {Promise<object|null>}
     */
    static async resolveCustomParams(context, overrides = {}) {
        return AbstractTask._defaultParamsBlob(context, overrides);
    }

    /**
     * Read main task envelope fields from `context.params` (CLI/env), with
     * any matching key on `overrides` taking precedence. Internal; called by
     * {@link AbstractTask.resolveParams}.
     *
     * @param {object} context
     * @param {Record<string, unknown>} [overrides]
     * @returns {object}
     */
    static _resolveMainFields(context, overrides = {}) {
        const defs = {
            queueName: "string default tasks",
            priority: "number default 50",
            serviceGroup: "string",
            serviceName: "string",
            instanceNumber: "number",
            serverName: "string",
            opid: "string",
            schedule: "string",
        };
        const cli = context.params.getAllForModule("task-envelope", defs);

        const name = emptyToUndef(overrides.name) ?? emptyToUndef(context.params.get("name", "string"));
        if (!name) {
            throw new ParamError("Task --name is required (e.g. ping, stop, dummyHarvest)");
        }

        let instanceNumber;
        const rawInstance = overrides.instanceNumber ?? cli.instanceNumber;
        if (rawInstance !== undefined && rawInstance !== null && String(rawInstance).trim() !== "") {
            const n = Number(rawInstance);
            if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
                throw new ParamError("--instanceNumber must be a positive integer when set");
            }
            instanceNumber = n;
        } else {
            instanceNumber = null;
        }

        const priorityRaw = overrides.priority ?? cli.priority ?? 50;
        const priority = Number(priorityRaw);
        if (!Number.isFinite(priority)) {
            throw new ParamError(`--priority must be a number (got ${JSON.stringify(priorityRaw)})`);
        }

        return {
            name,
            queueName: overrides.queueName ?? emptyToUndef(cli.queueName) ?? "tasks",
            priority,
            serviceGroup: emptyToUndef(overrides.serviceGroup) ?? emptyToUndef(cli.serviceGroup) ?? null,
            serviceName: emptyToUndef(overrides.serviceName) ?? emptyToUndef(cli.serviceName) ?? null,
            instanceNumber,
            serverName: emptyToUndef(overrides.serverName) ?? emptyToUndef(cli.serverName) ?? null,
            opid: emptyToUndef(overrides.opid) ?? emptyToUndef(cli.opid) ?? null,
            schedule: emptyToUndef(overrides.schedule) ?? emptyToUndef(cli.schedule) ?? null,
            nextRunAt: overrides.nextRunAt ?? null,
        };
    }

    /**
     * Default inner-params resolver: parses `--paramsJson` (must be a JSON
     * object), then overlays `overrides.params` on top. Returns `null` when
     * neither is provided.
     *
     * @param {object} context
     * @param {Record<string, unknown>} [overrides]
     * @returns {object|null}
     */
    static _defaultParamsBlob(context, overrides = {}) {
        const cli = context.params.getAllForModule("task-params", { paramsJson: "string" });
        const fromJson = parseParamsJson(cli.paramsJson);
        const fromOverride = pickParamsObject(overrides);
        if (!fromJson && !fromOverride) return null;
        return { ...(fromJson ?? {}), ...(fromOverride ?? {}) };
    }

    /**
     * Helper for subclass `resolveCustomParams` overrides. Reads typed CLI
     * params (per `defs`) plus `--paramsJson` under a module namespace, then
     * merges them with explicit `overrides.params` in increasing priority:
     *
     *   typed CLI flags → --paramsJson → overrides.params
     *
     * Undefined values are dropped so defaults declared in `defs` aren't
     * overwritten by missing-flag noise. Returns the merged object; the
     * caller is responsible for validation and throwing `ParamError`.
     *
     * @param {object} context
     * @param {string} moduleName Namespace for `--showUsedParams` grouping.
     * @param {Record<string, string>} defs Param defs in `getAllForModule` syntax.
     * @param {Record<string, unknown>} [overrides] As passed to `resolveCustomParams`.
     * @returns {Record<string, unknown>}
     */
    static _mergeTypedParams(context, moduleName, defs, overrides = {}) {
        const fullDefs = { ...defs, paramsJson: "string" };
        const cliRaw = context.params.getAllForModule(moduleName, fullDefs);
        const fromJson = parseParamsJson(cliRaw.paramsJson) ?? {};
        const fromCli = {};
        for (const [k, v] of Object.entries(cliRaw)) {
            if (k === "paramsJson") continue;
            if (v !== undefined && v !== null) fromCli[k] = v;
        }
        const fromOverride = pickParamsObject(overrides) ?? {};
        return { ...fromCli, ...fromJson, ...fromOverride };
    }
}

/** Trim a string-ish to a non-empty string, or return undefined. Non-strings pass through. */
function emptyToUndef(s) {
    if (s === undefined || s === null) return undefined;
    if (typeof s !== "string") return s;
    const t = s.trim();
    return t.length ? t : undefined;
}

/**
 * Parse a `--paramsJson` value. Returns `null` for empty/missing input.
 * Throws `ParamError` for non-JSON or non-object payloads.
 *
 * @param {unknown} raw
 * @returns {object|null}
 */
function parseParamsJson(raw) {
    if (raw == null) return null;
    const t = String(raw).trim();
    if (!t) return null;
    let parsed;
    try {
        parsed = JSON.parse(t);
    } catch (e) {
        throw new ParamError(`--paramsJson: not valid JSON: ${e?.message ?? String(e)}`);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new ParamError("--paramsJson must be a JSON object");
    }
    return parsed;
}

/** Extract `overrides.params` when it is a plain object, else undefined. */
function pickParamsObject(overrides) {
    const p = overrides?.params;
    if (p && typeof p === "object" && !Array.isArray(p)) return p;
    return undefined;
}
