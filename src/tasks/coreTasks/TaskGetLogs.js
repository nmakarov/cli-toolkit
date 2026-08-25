import { ParamError } from "../../errors.js";
import { AbstractTask } from "../AbstractTask.js";
import { readTaskIpcLogsSnapshot } from "../taskLogs.js";

/**
 * Fetches IPC FileDatabase rows for `dummyHarvest` (and similar) logs keyed by params.source / params.resource.
 * Intended for machine-targeted enqueue (`server_name` set, `service_group` null) so any runner on that host can execute.
 *
 * Params:
 *   - `source`   (required) — logical source name, e.g. `"actris"`
 *   - `resource` (required) — resource slug, e.g. `"properties"`
 *   - `tail`     — max records to return (clamped 1..10000; default 100)
 *   - `afterTs`  — ISO timestamp watermark; keeps only rows with `ts > afterTs`
 *   - `fromTs`   — inclusive lower bound (`ts >= fromTs`); scans older versions
 *   - `toTs`     — inclusive upper bound (`ts <= toTs`)
 */
export class TaskGetLogs extends AbstractTask {
    /**
     * @param {object} context
     * @param {Record<string, unknown>} [overrides]
     * @returns {Promise<{ source: string, resource: string, tail: number, afterTs?: string }>}
     */
    static async resolveCustomParams(context, overrides = {}) {
        const merged = AbstractTask._mergeTypedParams(context, "task-get-logs", {
            source: "string",
            resource: "string",
            tail: "number default 100",
            afterTs: "string",
            fromTs: "string",
            toTs: "string",
        }, overrides);
        const source = typeof merged.source === "string" ? merged.source.trim() : "";
        const resource = typeof merged.resource === "string" ? merged.resource.trim() : "";
        if (!source) throw new ParamError('getLogs: param "source" is required');
        if (!resource) throw new ParamError('getLogs: param "resource" is required');
        let tail = Number(merged.tail);
        if (!Number.isFinite(tail) || tail < 1) tail = 100;
        tail = Math.min(10_000, Math.max(1, Math.floor(tail)));
        const out = { source, resource, tail };
        if (typeof merged.afterTs === "string" && merged.afterTs.trim()) {
            out.afterTs = merged.afterTs.trim();
        }
        if (typeof merged.fromTs === "string" && merged.fromTs.trim()) {
            out.fromTs = merged.fromTs.trim();
        }
        if (typeof merged.toTs === "string" && merged.toTs.trim()) {
            out.toTs = merged.toTs.trim();
        }
        return out;
    }

    /**
     * @param {unknown} _reportProgress Unused (single-shot read, no progress events).
     * @returns {Promise<{ success: boolean, results: unknown }>}
     */
    async run(_reportProgress) {
        const p = this.task.params ?? {};
        const source = String(p.source ?? "").trim();
        const resource = String(p.resource ?? "").trim();
        const tail = Math.max(1, Math.min(10_000, Number(p.tail) > 0 ? Number(p.tail) : 100));
        const afterTs = p.afterTs != null && String(p.afterTs).trim() ? String(p.afterTs).trim() : null;
        const fromTs = p.fromTs != null && String(p.fromTs).trim() ? String(p.fromTs).trim() : null;
        const toTs = p.toTs != null && String(p.toTs).trim() ? String(p.toTs).trim() : null;

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
                fromTs,
                toTs,
            });
            return {
                success: true,
                results: { records, latestTs, source, resource },
            };
        } catch (e) {
            return {
                success: false,
                results: { error: e?.message ?? String(e) },
            };
        }
    }
}
