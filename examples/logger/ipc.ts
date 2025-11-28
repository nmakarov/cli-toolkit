#!/usr/bin/env node

import { Logger } from "../../src/logger/index.js";

// Run with: npx tsx examples/logger/ipc.ts

// Create a minimal context for standalone usage
const context = {} as any;
const logger = new Logger(context, { route: "ipc", timestamp: true });

logger.info("Sending message to parent process");
logger.request("ping", { hello: "world" });
logger.response("ping", { ok: true });


