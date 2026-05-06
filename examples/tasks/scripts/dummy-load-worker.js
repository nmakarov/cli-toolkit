#!/usr/bin/env node

import { init } from "../../../src/init/index.js";
import { sleepMs } from "../../../src/utils/index.js";

const defs = {
    source: "string required",
    resource: "string required",
    recordsCount: "number default 0",
    loadDelayMs: "number default 150",
    loadBatchSize: "number default 25",
    loadErrorChance: "number default 0",
    listingId: "string",
    photoUrlsJson: "string",
    opid: "string",
};

const flow = async (context) => {
    const {
        source,
        resource,
        recordsCount,
        loadDelayMs,
        loadBatchSize,
        loadErrorChance,
        listingId,
        photoUrlsJson,
        opid,
    } = context.params.getAll(defs);

    const totalIterations = Math.max(1, Math.ceil(recordsCount / loadBatchSize));
    for (let i = 1; i <= totalIterations; i += 1) {
        const loaded = Math.min(recordsCount, i * loadBatchSize);
        context.logger.progress("loading", {
            prefix: `workerLoad:${source}:${resource}`,
            count: loaded,
            total: recordsCount,
        });
        if (Math.random() < Math.max(0, Math.min(1, Number(loadErrorChance) || 0))) {
            const message = `[dummy-load-worker] load failed source=${source} resource=${resource} loaded=${loaded}/${recordsCount} opid=${opid || "none"}`;
            context.logger.error?.(message);
            throw new Error(message);
        }
        await sleepMs(loadDelayMs);
    }

    let photoUrls = [];
    if (photoUrlsJson) {
        try {
            const parsed = JSON.parse(photoUrlsJson);
            if (Array.isArray(parsed)) {
                photoUrls = parsed.map((x) => String(x));
            }
        } catch {
            photoUrls = [];
        }
    }

    const result = {
        source,
        resource,
        loaded: recordsCount,
        listingId: listingId || null,
        photoUrls,
        opid: opid || null,
    };
    context.logger.info?.(
        `[dummy-load-worker] done source=${source} resource=${resource} loaded=${recordsCount} listingId=${listingId || "none"}`
    );
    if (typeof process.send === "function") {
        process.send({ __taskWorkerResult: result });
    }
};

void init(flow);
