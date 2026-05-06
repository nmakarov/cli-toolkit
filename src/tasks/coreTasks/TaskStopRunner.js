import { ParamError } from "../../errors.js";
import { AbstractTask } from "../AbstractTask.js";

/**
 * Cooperative stop signal for the runner that claims it. Returns a result with
 * `stopRunner: true`; `runTasksLoop` sees that flag in `executeClaimedTask`'s
 * outcome and flips its own stop state, propagating `requestStop(allowanceMs)`
 * to every currently-running task.
 *
 * `params.allowanceMs` controls the grace window (default 5000 ms).
 */
export class TaskStopRunner extends AbstractTask {
    /**
     * Stop tasks must target a concrete instance — without `serviceName` the
     * row would race against any worker on the queue. Layered on top of the
     * envelope built by {@link AbstractTask.resolveParams}.
     *
     * @param {object} context
     * @param {Record<string, unknown>} [overrides]
     * @returns {Promise<object>}
     */
    static async resolveParams(context, overrides = {}) {
        const main = await super.resolveParams(context, overrides);
        if (!main.serviceName) {
            throw new ParamError(
                "stop/stopRunner requires --serviceName (registry instance name; optional --serviceGroup, --instanceNumber, --serverName to narrow targeting)"
            );
        }
        return main;
    }

    /**
     * @param {object} context
     * @param {Record<string, unknown>} [overrides]
     * @returns {Promise<{ allowanceMs: number }>}
     */
    static async resolveCustomParams(context, overrides = {}) {
        const merged = AbstractTask._mergeTypedParams(context, "task-stop", {
            allowanceMs: "number default 5000",
        }, overrides);
        const allowanceMs = Number(merged.allowanceMs);
        if (!Number.isFinite(allowanceMs) || allowanceMs < 0) {
            throw new ParamError(
                `stopRunner: allowanceMs must be a non-negative number (got ${JSON.stringify(merged.allowanceMs)})`
            );
        }
        return { allowanceMs };
    }

    /**
     * @returns {Promise<{ success: true, results: { stopRunner: true, allowanceMs: number, message: string } }>}
     */
    async run() {
        const allowanceMs = Number(this.task?.params?.allowanceMs ?? 5000);
        this.context.logger.warn?.(`[TaskStopRunner] stop requested (allowanceMs=${allowanceMs})`);
        return {
            success: true,
            results: {
                stopRunner: true,
                allowanceMs,
                message: "Runner stop requested",
            },
        };
    }
}
