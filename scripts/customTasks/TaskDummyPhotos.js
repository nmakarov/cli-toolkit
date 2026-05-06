import { sleepMs } from "../../src/utils/index.js";
import { ParamError } from "../../src/errors.js";
import { AbstractTask } from "../../src/tasks/AbstractTask.js";

export class TaskDummyPhotos extends AbstractTask {
    /**
     * @param {object} context
     * @param {Record<string, unknown>} [overrides]
     * @returns {Promise<object>}
     */
    static async resolveCustomParams(context, overrides = {}) {
        const merged = AbstractTask._mergeTypedParams(context, "task-dummy-photos", {
            source: "string",
            resource: "string",
            listingId: "string",
        }, overrides);

        const source = typeof merged.source === "string" ? merged.source.trim() : "";
        const resource = typeof merged.resource === "string" ? merged.resource.trim() : "";
        if (!source) throw new ParamError('dummyPhotos: param "source" is required');
        if (!resource) throw new ParamError('dummyPhotos: param "resource" is required');

        const out = { source, resource };
        if (typeof merged.listingId === "string" && merged.listingId.trim()) {
            out.listingId = merged.listingId.trim();
        }
        const ovParams = overrides && typeof overrides.params === "object" && overrides.params !== null && !Array.isArray(overrides.params)
            ? overrides.params : null;
        if (ovParams && Array.isArray(ovParams.photoUrls)) {
            out.photoUrls = ovParams.photoUrls;
        }
        return out;
    }

    async run(reportProgress) {
        const p = this.task.params ?? {};
        const source = String(p.source ?? "");
        const resource = String(p.resource ?? "");
        const opid = this.task.opid ?? null;

        const steps = 5;
        const delayMs = 80;
        for (let i = 1; i <= steps; i += 1) {
            await reportProgress({
                phase: "photos",
                source,
                resource,
                step: i,
                total: steps,
                opid,
            });
            await sleepMs(delayMs);
        }

        return {
            success: true,
            results: {
                message: "dummyPhotos complete",
                opid,
                source,
                resource,
            },
        };
    }
}
