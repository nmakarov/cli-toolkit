#!/usr/bin/env node

/**
 * HttpClient2 Basic Usage – uses init, context, logger
 *
 * Run with: npx tsx examples/http-client2/basic-usage.ts
 * Options: --timeout=10000 --debug=true
 */

import { init } from "@nmakarov/cli-toolkit/init";
import { HttpClient } from "../../src/http-client2/index.js";

const flow = async (context) => {
  const { logger } = context;

  const client = HttpClient.init(context, {
    userAgent: "HttpClient2-Example/1.0",
    retryJitter: 0.2,
  });

  const { debug } = context.params.getAll({
    debug: "boolean default false",
  });

  const cfg = client.getConfig();
  logger.info("HttpClient2 (fetch-based) Basic Usage");
  logger.info(`  timeout=${cfg.timeout}ms, debug=${debug}`);

  logger.info("Example 1: Successful GET Request");
  const r1 = await client.get("https://httpbin.org/get", {
    params: { test: "example", timestamp: Date.now() },
    headers: { "X-Custom-Header": "HttpClient2-Test" },
    debug,
  });

  logger.info(`  status=${r1.status} code=${r1.code} duration=${r1.duration}ms`);
  if (r1.data?.headers?.["X-Custom-Header"]) {
    logger.info(`  custom header echo: ${r1.data.headers["X-Custom-Header"]}`);
  }

  logger.info("Example 2: POST Request");
  const r2 = await client.post("https://httpbin.org/post", {
    data: { name: "HttpClient2", features: ["retry", "fetch", "no-axios"] },
  });

  logger.info(`  status=${r2.status} code=${r2.code}`);
  if (r2.data?.json) {
    logger.info(`  echo: ${JSON.stringify(r2.data.json)}`);
  }

  logger.info("Example 3: Error Handling (404)");
  const r3 = await client.get("https://httpbin.org/status/404");
  logger.info(`  status=${r3.status} error=${r3.error ?? "N/A"}`);

  logger.info("HttpClient2 demonstration completed");
};

init(flow);
