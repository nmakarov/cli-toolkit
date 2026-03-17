#!/usr/bin/env node

/**
 * HttpClient2 Request - make HTTP requests from CLI
 *
 * Usage:
 *   npx tsx examples/http-client2/request.ts --url=https://httpbin.org/get
 *   npx tsx examples/http-client2/request.ts --url=https://httpbin.org/post --method=POST --data='{"name":"test","count":42}'
 *   npx tsx examples/http-client2/request.ts --url=https://api.example.com/users --method=POST --data='{ name: "John", ids: [1,2,3] }'
 *
 * Params:
 *   --url       Request URL (required, may include query string)
 *   --method    HTTP method (default GET)
 *   --data      Request body - JSON or json-like object literal for POST/PUT/PATCH
 *
 * All other http-client2 params are supported (timeout, baseURL, saveMock, useMock,
 * mocksPath, useTestServer, showRequest, showResponse, etc.) - they are picked up
 * by HttpClient.init from context.params.
 */

import { init } from "@nmakarov/cli-toolkit/init";
import { HttpClient } from "../../src/http-client2/index.js";
import type { HttpMethod } from "../../src/http-client2/types.js";

/** Parse JSON or json-like string (object literal with unquoted keys) */
function parseData(dataStr: string | undefined): any {
  if (dataStr == null || dataStr.trim() === "") return undefined;
  const s = dataStr.trim();
  try {
    return JSON.parse(s);
  } catch {
    // Try json-like: quote unquoted keys (e.g. { a: 1 } -> {"a": 1})
    try {
      const fixed = s.replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '"$1":');
      return JSON.parse(fixed);
    } catch (e) {
      throw new Error(`Invalid --data: expected JSON or json-like object. ${(e as Error).message}`);
    }
  }
}

const flow = async (context: any) => {
  const { logger, params } = context;

  const { url, method, data: dataStr } = params.getAll({
    url: "string required",
    method: "string default GET",
    data: "string",
  });

  const httpMethod = (method || "GET").toUpperCase() as HttpMethod;
  const validMethods: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
  if (!validMethods.includes(httpMethod)) {
    throw new Error(`Invalid --method: ${method}. Must be one of: ${validMethods.join(", ")}`);
  }

  let data: any;
  try {
    data = parseData(dataStr);
  } catch (e) {
    logger.error((e as Error).message);
    process.exit(1);
  }

  const client = HttpClient.init(context);

  const options: Record<string, any> = {};
  if (data != null && ["POST", "PUT", "PATCH"].includes(httpMethod)) {
    options.data = data;
  }

  logger.info(`${httpMethod} ${url}`);
  const response = await client.request(httpMethod, url, options);

  logger.info(`  status=${response.status} code=${response.code} duration=${response.duration}ms`);
  if (response.error) {
    logger.info(`  error=${response.error}`);
  }
  if (response.data != null) {
    logger.info(`  body: ${JSON.stringify(response.data).slice(0, 500)}${JSON.stringify(response.data).length > 500 ? "..." : ""}`);
  }
};

init(flow);
