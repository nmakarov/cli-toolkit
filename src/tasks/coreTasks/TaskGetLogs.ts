import { AbstractTask } from "../AbstractTask.js";
import { readTaskIpcLogsSnapshot } from "../taskLogs.js";
import type { TaskResult } from "../types.js";

/**
 * Fetches IPC FileDatabase rows for `dummyHarvest` (and similar) logs keyed by params.source / params.resource.
 * Intended for machine-targeted enqueue (`server_name` set, `service_group` null) so any runner on that host can execute.
 */
export class TaskGetLogs extends AbstractTask {
    async run(_reportProgress: (progress: any) => Promise<void>): Promise<TaskResult> {
        const p = (this.task.params ?? {}) as Record<string, unknown>;
        const source = String(p.source ?? "").trim();
        const resource = String(p.resource ?? "").trim();
        const tail = Math.max(1, Math.min(10_000, Number(p.tail) > 0 ? Number(p.tail) : 100));
        const afterTs = p.afterTs != null && String(p.afterTs).trim() ? String(p.afterTs).trim() : null;

        if (!source || !resource) {
            return {
                success: false,
                results: { error: 'getLogs requires params "source" and "resource"' },
            };
        }

        try {
            const { records, latestTs } = await readTaskIpcLogsSnapshot(this.context, {
                source,
                resource,
                tail,
                afterTs,
            });
            return {
                success: true,
                results: { records, latestTs, source, resource },
            };
        } catch (e: any) {
            return {
                success: false,
                results: { error: e?.message ?? String(e) },
            };
        }
    }
}
