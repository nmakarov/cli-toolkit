#!/usr/bin/env node

/**
 * Example demonstrating --stopAfter=init feature
 * 
 * Run with: npx tsx examples/logger/stop-after-init.ts --stopAfter=init
 * Run with: npx tsx examples/logger/stop-after-init.ts --stopAfter=init --mode=json --prefix=test
 */

import { init } from "../../src/init/index.js";
import { Logger } from "../../src/logger/index.js";

const flow = async (context) => {
    // Initialize logger (this will collect parameters)
    const logger = Logger.init(context);

    // This code won't execute if --stopAfter=init is set
    logger.info("This should not appear if --stopAfter=init is used");
};

init(flow, {
    mode: "text",
    prefix: "example",
    modules: ["logger"],
});

