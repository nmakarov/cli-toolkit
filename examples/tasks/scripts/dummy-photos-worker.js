#!/usr/bin/env node

import { init } from "../../../src/init/index.js";
import { sleepMs } from "../../../src/utils/index.js";

const defs = {
    listingId: "string required",
    photoUrlsJson: "string required",
    photoDelayMs: "number default 120",
    opid: "string",
};

const flow = async (context) => {
    const { listingId, photoUrlsJson, photoDelayMs, opid } = context.params.getAll(defs);
    let photoUrls = [];
    try {
        const parsed = JSON.parse(photoUrlsJson);
        if (Array.isArray(parsed)) {
            photoUrls = parsed.map((x) => String(x));
        }
    } catch {
        photoUrls = [];
    }

    if (photoUrls.length === 0) {
        context.logger.warn?.(`[dummy-photos-worker] no photos to process listingId=${listingId}`);
    }

    const processed = [];
    for (let i = 0; i < photoUrls.length; i += 1) {
        const url = photoUrls[i];
        const action = i % 4 === 0 ? "delete" : "upload";
        processed.push({ url, action });
        context.logger.progress("photos", {
            prefix: `workerPhotos:${listingId}`,
            count: i + 1,
            total: photoUrls.length,
        });
        await sleepMs(photoDelayMs);
    }

    const result = {
        listingId,
        total: photoUrls.length,
        upload: processed.filter((p) => p.action === "upload").length,
        delete: processed.filter((p) => p.action === "delete").length,
        opid: opid || null,
    };
    context.logger.info?.(
        `[dummy-photos-worker] done listingId=${listingId} total=${result.total} upload=${result.upload} delete=${result.delete}`
    );
    if (typeof process.send === "function") {
        process.send({ __taskWorkerResult: result });
    }
};

void init(flow);
