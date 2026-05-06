#!/usr/bin/env node

// Run with: npx tsx examples/init/params.ts --since=-2d

import { init } from "../../src/init/index.js";

// Define parameter definitions
const defs = {
    since: "edate",
};

const flow = async (context) => {
    const { logger, params } = context;

    // Get parameters using Params.getAll()
    const { since } = params.getAll(defs);

    logger.info("since:", since);
};

init(flow);

