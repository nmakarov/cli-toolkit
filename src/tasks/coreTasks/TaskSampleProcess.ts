import { sleepMs } from "../../utils/index.js";
import type { TaskResult } from "../types.js";
import { TaskMaster } from "../TaskMaster.js";

export class TaskSampleProcess extends TaskMaster {
    private stopRequested = false;
    private stopAllowanceMs = 0;
    private stopDecisionLogged = false;

    requestStop(allowanceMs: number): void {
        this.stopRequested = true;
        this.stopAllowanceMs = Number.isFinite(allowanceMs) && allowanceMs > 0 ? allowanceMs : 0;
        this.context.logger.warn?.(
            `[TaskSampleProcess] stop signal received (${this.task.id}), allowanceMs=${this.stopAllowanceMs}`
        );
    }

    async run(reportProgress: (progress: any) => Promise<void>): Promise<TaskResult> {
        const totalRaw = this.task?.params?.total ?? 10;
        const delayRaw = this.task?.params?.delay ?? 1000;
        const nameRaw = this.task?.params?.name;

        const total = Number(totalRaw);
        const delay = Number(delayRaw);
        const name = typeof nameRaw === "string" && nameRaw.trim() ? nameRaw.trim() : "sampleProcess";

        const errors: string[] = [];
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
