#!/usr/bin/env node

/**
 * Logger example using init() static method for CLI parameter collection
 * 
 * Run with: npx tsx examples/logger/with-init.ts
 * Run with: npx tsx examples/logger/with-init.ts --mode=json --route=console
 * Run with: npx tsx examples/logger/with-init.ts --prefix=myapp --silent=false
 */

import { init } from "../../src/init/index.js";
import { Logger } from "../../src/logger/index.js";

const flow = async (context) => {
    // Use init() static method to create logger with CLI parameters
    const logger = Logger.init(context, {
        // Options here can override CLI args
        // timestamp: true, // Uncomment to override CLI args
    });

    logger.info("Logger created using init() static method");
    logger.info(`Mode: ${(logger ).options?.mode || "unknown"}`);
    logger.info(`Route: ${(logger ).options?.route || "unknown"}`);
    
    // Use the logger
    logger.debug("Debug message");
    logger.warn("Warning message");
    logger.error("Error message");

    // Display all figured parameters
    const figuredParams = context.params.getAllFigured();
    if (Object.keys(figuredParams).length > 0) {
        logger.info("");
        logger.info("All Figured Parameters:");
        for (const [key, param] of Object.entries(figuredParams) ) {
            logger.info(`  ${key.padEnd(20)}: ${JSON.stringify(param.value)} (from ${param.source})`);
        }
    }
};

init(flow);

