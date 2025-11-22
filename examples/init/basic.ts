#!/usr/bin/env node

// Run with: npx tsx examples/init/basic.ts
// Run with: npx tsx examples/init/basic.ts --verbose

import { init } from "../../src/init/index.js";

// Define parameter definitions

const flow = async (context) => {
    const { logger, params } = context;

    // Get parameters using Params
    const defs = {
        verbose: "boolean",
    };

    const { verbose } = params.getAll(defs);

    logger.info("Flow started");
    if (verbose) {
        logger.debug("Verbose mode enabled");
    }

    logger.info("Flow completed");
};

init(flow, {
    logger: {
        mode: "text",
        route: "console",
    },
});

