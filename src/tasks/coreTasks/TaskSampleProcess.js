import { sleepMs } from "../../utils/index.js";
import { ParamError } from "../../errors.js";
import { AbstractTask } from "../AbstractTask.js";

/**
 * Long-running demo task used for exercising the runner's progress/stop paths.
 *
 * Ticks `total` times with `delay` ms between iterations, calling `reportProgress`
 * each tick. Honors cooperative stop (`requestStop`) by completing the current
 * iteration and deciding whether to finish the run or abort based on the
 * remaining work vs. the allowance window.
 */
export class TaskSampleProcess extends AbstractTask {
    /**
     * @param {object} context
     * @param {Record<string, unknown>} [overrides]
     * @returns {Promise<{ total: number, delay: number, name?: string }>}
     */
    static async resolveCustomParams(context, overrides = {}) {
        const merged = AbstractTask._mergeTypedParams(context, "task-sample-process", {
            total: "number default 10",
            delay: "number default 1000",
            name: "string",
        }, overrides);
        const total = Number(merged.total);
        const delay = Number(merged.delay);
        if (!Number.isInteger(total) || total <= 0) {
            throw new ParamError(`sampleProcess: param "total" must be a positive integer (got ${JSON.stringify(merged.total)})`);
        }
        if (!Number.isInteger(delay) || delay < 0) {
            throw new ParamError(`sampleProcess: param "delay" must be an integer >= 0 (got ${JSON.stringify(merged.delay)})`);
        }
        const out = { total, delay };
        if (typeof merged.name === "string" && merged.name.trim()) {
            out.name = merged.name.trim();
        }
        return out;
    }

    /**
     * @param {object} context
     * @param {object} task
     */
    constructor(context, task) {
        super(context, task);
        this.stopRequested = false;
        this.stopAllowanceMs = 0;
        this.stopDecisionLogged = false;
    }

    /**
     * Runner-facing stop signal. Records the allowance window so the main loop
     * can decide per-iteration whether to finish or abort early.
     *
     * @param {number} allowanceMs
     */
    requestStop(allowanceMs) {
        this.stopRequested = true;
        this.stopAllowanceMs = Number.isFinite(allowanceMs) && allowanceMs > 0 ? allowanceMs : 0;
        this.context.logger.warn?.(
            `[TaskSampleProcess] stop signal received (${this.task.id}), allowanceMs=${this.stopAllowanceMs}`
        );
    }

    /**
     * Iterate `total` times, sleeping `delay` ms between ticks and reporting
     * progress every iteration. Validates params up front; invalid values short-
     * circuit to a structured failure without starting the loop.
     *
     * @param {(progress: object) => Promise<void>} reportProgress
     * @returns {Promise<{ success: boolean, results: unknown }>}
     */
    async run(reportProgress) {
        const totalRaw = this.task?.params?.total ?? 10;
        const delayRaw = this.task?.params?.delay ?? 1000;
        const nameRaw = this.task?.params?.name;

        const total = Number(totalRaw);
        const delay = Number(delayRaw);
        const name = typeof nameRaw === "string" && nameRaw.trim() ? nameRaw.trim() : "sampleProcess";

        const errors = [];
        if (!Number.isInteger(total) || total <= 0) {
            errors.push('param "total" must be a positive integer');
        }
        if (!Number.isInteger(delay) || delay < 0) {
            errors.push('param "delay" must be an integer >= 0');
        }

        if (errors.length > 0) {
            return {
                success: false,
                results: {
                    error: `Validation failed: ${errors.join(", ")}`,
                    received: { total: totalRaw, delay: delayRaw, name: nameRaw },
                },
            };
        }

        const startedAt = Date.now();
        for (let i = 1; i <= total; i += 1) {
            if (this.stopRequested) {
                const remainingMs = Math.max(0, (total - i + 1) * delay);
                if (remainingMs <= this.stopAllowanceMs) {
                    if (!this.stopDecisionLogged) {
                        this.stopDecisionLogged = true;
                        this.context.logger.warn?.(
                            `[TaskSampleProcess] continue to finish (${this.task.id}): remainingMs=${remainingMs} <= allowanceMs=${this.stopAllowanceMs}`
                        );
                    }
                } else {
                    this.context.logger.warn?.(
                        `[TaskSampleProcess] stopping gracefully at iteration ${i}/${total} (${this.task.id}), remainingMs=${remainingMs} > allowanceMs=${this.stopAllowanceMs}`
                    );
                    return {
                        success: false,
                        results: {
                            message: `Stopped before completion at iteration ${i}/${total}`,
                            completed: i - 1,
                            total,
                            name,
                            remainingMs,
                            allowanceMs: this.stopAllowanceMs,
                        },
                    };
                }
            }

            const elapsed = Date.now() - startedAt;
            const remaining = Math.max(0, (total - i) * delay);
            const progress = {
                name,
                count: i,
                total,
                elapsedMs: elapsed,
                remainingMs: remaining,
                status: `running ${name}: ${i}/${total}`,
            };

            this.context.logger.progress("running", {
                prefix: name,
                count: i,
                total,
            });
            await reportProgress(progress);
            await sleepMs(delay);
        }

        return {
            success: true,
            results: {
                message: `Completed ${total} iterations`,
                total,
                delay,
                name,
            },
        };
    }
}
