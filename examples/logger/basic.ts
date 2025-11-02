#!/usr/bin/env node

import { CliToolkitLogger } from "../../src/logger/index.js";

// Run with: npx tsx examples/logger/basic.ts

const logger = new CliToolkitLogger({
    prefix: "example",
    timestamp: true,
    progress: { withTimes: true }
});

logger.info("Starting basic logger example");
logger.debug("Debug details", { step: 1 });
logger.notice("Notice a milestone");
logger.warn("Potential issue detected");
logger.error("Something went wrong", new Error("Sample error"));

for (let count = 1; count <= 5; count++) {
    logger.progress("Processing", { prefix: "loop", count, total: 5 });
}

logger.results({ status: "done", records: 5 });


