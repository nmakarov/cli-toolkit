import { ParamError } from "../../errors.js";
import { AbstractTask } from "../AbstractTask.js";

/**
 * Sanity-check task for wiring: reads `params.a` and `params.b` (both numbers),
 * returns `{ a, b, sum }`. Any non-numeric input short-circuits to a structured
 * validation failure, not an exception.
 */
export class TaskSumAB extends AbstractTask {
    /** Short, deterministic — wait by default so callers see the sum. */
    static defaultWaitForResult = true;

    /**
     * @param {object} context
     * @param {Record<string, unknown>} [overrides]
     * @returns {Promise<{ a: number, b: number }>}
     */
    static async resolveCustomParams(context, overrides = {}) {
        const merged = AbstractTask._mergeTypedParams(context, "task-sumab", {
            a: "number",
            b: "number",
        }, overrides);
        if (typeof merged.a !== "number" || Number.isNaN(merged.a)) {
            throw new ParamError(`taskSumAB: param "a" must be a valid number (got ${JSON.stringify(merged.a)})`);
        }
        if (typeof merged.b !== "number" || Number.isNaN(merged.b)) {
            throw new ParamError(`taskSumAB: param "b" must be a valid number (got ${JSON.stringify(merged.b)})`);
        }
        return { a: merged.a, b: merged.b };
    }

    /**
     * @returns {Promise<{ success: boolean, results: unknown }>}
     */
    async run() {
        const a = this.task?.params?.a;
        const b = this.task?.params?.b;

        if (typeof a !== "number" || Number.isNaN(a)) {
            return {
                success: false,
                results: {
                    error: 'Validation failed: param "a" must be a valid number',
                    received: { a, b },
                },
            };
        }

        if (typeof b !== "number" || Number.isNaN(b)) {
            return {
                success: false,
                results: {
                    error: 'Validation failed: param "b" must be a valid number',
                    received: { a, b },
                },
            };
        }

        const sum = a + b;
        this.context.logger.info?.(`[TaskSumAB] ${a} + ${b} = ${sum} (${this.task.id})`);
        return {
            success: true,
            results: { a, b, sum },
        };
    }
}
