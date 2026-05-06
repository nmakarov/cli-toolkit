#!/usr/bin/env node

import { init } from "../../../src/init/index.js";
import { sleepMs } from "../../../src/utils/index.js";

function randomIntInclusive(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

const defs = {
    source: "string required",
    resource: "string required",
    minRecords: "number default 50",
    maxRecords: "number default 500",
    delayMs: "number default 200",
    batchSize: "number default 25",
    harvestErrorChance: "number default 0",
    opid: "string",
};

const flow = async (context) => {
    const { source, resource, minRecords, maxRecords, delayMs, batchSize, harvestErrorChance, opid } = context.params.getAll(defs);
    const totalRecords = randomIntInclusive(minRecords, maxRecords);
    const totalIterations = Math.max(1, Math.ceil(totalRecords / batchSize));
    let fetched = 0;

    context.logger.info?.(
        `[dummy-harvest-worker] start source=${source} resource=${resource} totalRecords=${totalRecords} opid=${opid || "none"}`
    );

    for (let i = 1; i <= totalIterations; i += 1) {
        fetched = Math.min(totalRecords, i * batchSize);
        context.logger.progress("harvesting", {
            prefix: `workerHarvest:${source}:${resource}`,
            count: fetched,
            total: totalRecords,
        });
        if (Math.random() < Math.max(0, Math.min(1, Number(harvestErrorChance) || 0))) {
            const message = `[dummy-harvest-worker] fetch failed source=${source} resource=${resource} fetched=${fetched}/${totalRecords} opid=${opid || "none"}`;
            context.logger.error?.(message);
            throw new Error(message);
        }
        await sleepMs(delayMs);
    }

    const listingId = `listing_${source}_${resource}_${Date.now()}`;
    const photoUrls = resource === "properties"
        ? Array.from({ length: 5 }, (_, i) => `https://photos.example/${source}/${listingId}/${i + 1}.jpg`)
        : [];

    const result = {
        source,
        resource,
        fetched,
        totalRecords,
        listingId,
        photoUrls,
        opid: opid || null,
    };

    context.logger.info?.(
        `[dummy-harvest-worker] done source=${source} resource=${resource} fetched=${fetched} listingId=${listingId}`
    );
    if (typeof process.send === "function") {
        process.send({ __taskWorkerResult: result });
    }
};

void init(flow);
