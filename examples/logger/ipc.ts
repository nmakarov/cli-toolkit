#!/usr/bin/env node

import { CliToolkitLogger } from "../../src/logger/index.js";

// Run with: npx tsx examples/logger/ipc.ts

const logger = new CliToolkitLogger({ route: "ipc", timestamp: true });

logger.info("Sending message to parent process");
logger.request("ping", { hello: "world" });
logger.response("ping", { ok: true });


