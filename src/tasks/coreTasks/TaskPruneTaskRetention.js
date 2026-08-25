import { AbstractTask } from "../AbstractTask.js";
import { pruneTaskRetention, seedTaskRetentionRuntime } from "../taskRetention.js";

/**
 * Run one history + IPC log retention pass on this host (same cutoff both stores).
 * Also runs automatically from the tasks loop; this task is the "do it now" hook.
 */
export class TaskPruneTaskRetention extends AbstractTask {
    static defaultWaitForResult = true;

    /**
     * @returns {Promise<{ success: boolean, results: unknown }>}
     */
    async run() {
        seedTaskRetentionRuntime(this.context);
        const results = await pruneTaskRetention(this.context, { force: true });
        return { success: true, results };
    }
}
