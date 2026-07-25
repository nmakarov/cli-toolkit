import { ParamError } from "../../errors.js";
import { AbstractTask } from "../AbstractTask.js";
import { applyRuntimeParam, applyRuntimePatch } from "../runtimeParams.js";
import { listServicesRegistry } from "../servicesRegistry.js";
import { enqueueTask } from "../taskUtils.js";

/**
 * Hot-update runner knobs without restarting the process.
 *
 * Apply to `context.tasksRuntime` (loop re-reads `maxParallel` / `pollMs` /
 * `claimJitterMs` / `scanLimit` every tick) and to the logger for level-related
 * keys (`levels`, `silent`, …).
 *
 * Targeting (same idea as stop):
 *   - `--serviceName=<registry name>` → one instance
 *   - `--serviceGroup=photos` without serviceName → broadcast to every alive
 *     instance in that group (via {@link TaskSetRuntimeParam.enqueue})
 *
 * Params (any of):
 *   - `--paramKey=maxParallel --paramValue=16`
 *   - `--paramsJson='{"key":"maxParallel","value":16}'`
 *   - `--paramsJson='{"patch":{"maxParallel":16,"levels":"+debug"}}'`
 */
export class TaskSetRuntimeParam extends AbstractTask {
    static defaultWaitForResult = true;

    /**
     * @param {object} context
     * @param {Record<string, unknown>} [overrides]
     * @returns {Promise<object>}
     */
    static async resolveParams(context, overrides = {}) {
        const main = await super.resolveParams(context, overrides);
        if (!main.serviceName && !main.serviceGroup) {
            throw new ParamError(
                "setRuntimeParam requires --serviceName (one instance) or --serviceGroup (broadcast to alive instances)"
            );
        }
        return main;
    }

    /**
     * @param {object} context
     * @param {Record<string, unknown>} [overrides]
     * @returns {Promise<{ key?: string, value?: unknown, patch?: Record<string, unknown> }>}
     */
    static async resolveCustomParams(context, overrides = {}) {
        const merged = AbstractTask._mergeTypedParams(
            context,
            "task-set-runtime-param",
            {
                paramKey: "string",
                paramValue: "string",
                key: "string",
                value: "string",
            },
            overrides
        );

        if (merged.patch && typeof merged.patch === "object" && !Array.isArray(merged.patch)) {
            if (Object.keys(merged.patch).length === 0) {
                throw new ParamError("setRuntimeParam: patch is empty");
            }
            return { patch: { ...merged.patch } };
        }

        const key = merged.paramKey || merged.key;
        const value = merged.paramValue !== undefined ? merged.paramValue : merged.value;

        if (!key) {
            throw new ParamError(
                'setRuntimeParam requires --paramKey/--paramValue, or --paramsJson \'{"key":"maxParallel","value":16}\' / \'{"patch":{...}}\''
            );
        }

        // CLI strings: try JSON parse for numbers/bools/objects; else keep string
        let parsed = value;
        if (typeof value === "string") {
            const t = value.trim();
            if (t === "true") parsed = true;
            else if (t === "false") parsed = false;
            else if (t !== "" && !Number.isNaN(Number(t)) && /^-?\d+(\.\d+)?$/.test(t)) {
                parsed = Number(t);
            } else if (
                (t.startsWith("{") && t.endsWith("}")) ||
                (t.startsWith("[") && t.endsWith("]")) ||
                (t.startsWith('"') && t.endsWith('"'))
            ) {
                try {
                    parsed = JSON.parse(t);
                } catch {
                    parsed = value;
                }
            }
        }

        return { key: String(key), value: parsed };
    }

    /**
     * Enqueue one or many setRuntimeParam tasks. Prefer this over a bare
     * `enqueueTask` when broadcasting to a service group.
     *
     * @param {object} context
     * @param {Record<string, unknown>} [overrides]
     * @returns {Promise<{ ids: string[], targets: string[] }>}
     */
    static async enqueue(context, overrides = {}) {
        const payload = await this.resolveParams(context, { ...overrides, name: "setRuntimeParam" });
        const queueName = payload.queueName ?? "tasks";

        if (payload.serviceName) {
            const id = await enqueueTask(context, payload);
            return { ids: [id], targets: [payload.serviceName] };
        }

        const group = String(payload.serviceGroup || "").trim();
        if (!group) {
            throw new ParamError("setRuntimeParam.enqueue: serviceGroup required for broadcast");
        }

        const alive = await listServicesRegistry(context, {
            queueName,
            serviceGroup: group,
            staleMs: overrides.staleMs ?? 45_000,
        });
        if (!alive.length) {
            throw new ParamError(
                `setRuntimeParam: no alive services in group="${group}" queue="${queueName}"`
            );
        }

        const ids = [];
        const targets = [];
        for (const reg of alive) {
            const id = await enqueueTask(context, {
                ...payload,
                serviceGroup: group,
                serviceName: reg.service_name,
                serverName: reg.server_name ?? null,
                instanceNumber: reg.instance_number ?? null,
            });
            ids.push(id);
            targets.push(reg.service_name);
        }
        context.logger?.info?.(
            `[setRuntimeParam] broadcast to ${targets.length} instance(s) in group=${group}: ${targets.join(", ")}`
        );
        return { ids, targets };
    }

    /**
     * @returns {Promise<{ success: true, results: object }>}
     */
    async run() {
        const params = this.task?.params ?? {};
        let changes;
        if (params.patch && typeof params.patch === "object") {
            changes = await applyRuntimePatch(this.context, params.patch);
        } else {
            changes = [await applyRuntimeParam(this.context, params.key, params.value)];
        }

        const summary = changes.map((c) => `${c.key}: ${JSON.stringify(c.previous)} → ${JSON.stringify(c.next)}`);
        this.context.logger.warn?.(
            `[TaskSetRuntimeParam] applied on ${this.context.servicesRegistry?.serviceName ?? "runner"}: ${summary.join("; ")}`
        );

        return {
            success: true,
            results: {
                runtimeParamApplied: true,
                changes,
                runtime: { ...(this.context.tasksRuntime ?? {}) },
            },
        };
    }
}
