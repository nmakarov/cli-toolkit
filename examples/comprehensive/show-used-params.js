#!/usr/bin/env node

/**
 * Comprehensive example: Params + --showUsedParams
 *
 * Main script uses params.getAll() (module "script"). Components can use
 * params.getAllForModule("moduleName", defs) so that --showUsedParams output
 * is grouped by module. Non-default values are highlighted (bright white).
 *
 * Run:
 *   npx tsx examples/comprehensive/show-used-params.ts
 *   npx tsx examples/comprehensive/show-used-params.ts --timeout=8000 --name=test
 *   npx tsx examples/comprehensive/show-used-params.ts --showUsedParams --mode=console
 *
 * With --showUsedParams, "[Params]: list of used params:" is logged at debug on exit.
 */

import { init } from "../../src/init/index.js";

const flow = async (context) => {
  const { logger, params } = context;

  // getAll() = getAllForModule("script", defs) — appears under [script] with --showUsedParams
  const { timeout, debug, name, limit } = params.getAll({
    timeout: "number default 5000",
    debug: "boolean default false",
    name: "string",
    limit: "number default 100",
  });

  logger.info(`Running with params: timeout=${timeout}, debug=${debug}, name=${name ?? "(none)"}, limit=${limit}`);
  logger.debug("Debug message (visible when debug=true or level allows)");

  // When run with --showUsedParams, context.registerCleanup (in init) will
  // run on exit and log all figured params via logger.debug.
};

init(flow);
