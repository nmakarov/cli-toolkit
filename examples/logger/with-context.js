#!/usr/bin/env node

/**
 * Logger example using context-based initialization
 * 
 * Run with: npx tsx examples/logger/with-context.ts
 * Run with: npx tsx examples/logger/with-context.ts --mode=json --prefix=myapp
 * Run with: npx tsx examples/logger/with-context.ts --stopAfter=init
 */

import { init } from "../../src/init/index.js";


const flow = async (context) => {
    const { logger } = context;

    logger.info("Starting logger example with context");
    logger.debug("Debug details", { step: 1 });
    logger.notice("Notice a milestone");
    logger.warn("Potential issue detected");
    logger.error("Something went wrong", new Error("Sample error"));

    for (let count = 1; count <= 5; count++) {
        logger.progress("Processing", { prefix: "loop", count, total: 5 });
    }

    logger.results({ status: "done", records: 5 });
};

init(flow, {
    // Component-specific options at top level
    mode: "text",
    route: "console",
    // Specify which components to auto-instantiate
    modules: ["logger"],
});

