import { AbstractTask } from "../AbstractTask.js";

/**
 * Trivial health-check task: used by `registryMaintenance` to probe runners and
 * by operators to confirm a runner is picking up work. Emits a log line and
 * returns `{ success: true, results: "pong" }`.
 */
export class TaskPing extends AbstractTask {
    /** Default-wait so `send-task --name=ping` prints a result without `--wait`. */
    static defaultWaitForResult = true;

    /** Ping takes no params. */
    static async resolveCustomParams() {
        return null;
    }

    /**
     * @returns {Promise<{ success: true, results: "pong" }>}
     */
    async run() {
        this.context.logger.info?.(`[TaskPing] pong (${this.task.id})`);
        return { success: true, results: "pong" };
    }
}
