#!/usr/bin/env node

/**
 * Logger example demonstrating configure() method
 * 
 * Run with: npx tsx examples/logger/with-configure.ts
 */

import { init } from "../../src/init/index.js";

const flow = async (context) => {
    const { logger } = context;

    logger.info("Initial logger configuration");

    // Reconfigure logger at runtime
    logger.configure({
        mode: "json",
        prefix: "reconfigured",
    });

    logger.info("Logger reconfigured to JSON mode");
    logger.debug("This will be in JSON format");

    // Reconfigure again
    logger.configure({
        mode: "text",
        showLevel: false,
    });

    logger.info("Logger reconfigured to text mode without level");
    logger.warn("Warning without level prefix");
};

init(flow);

