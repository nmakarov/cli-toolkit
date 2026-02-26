#!/usr/bin/env node

/**
 * Comprehensive example: Initialize ALL cli-toolkit modules + --showUsedParams
 *
 * This script initializes an instance of every module that uses params in this
 * toolkit (Logger is created by init(); Db, HttpClient, FileDatabase are
 * created in the flow). Each module pulls its own params via getAllForModule
 * inside its init(). Use --showUsedParams to see the full list at exit.
 *
 * Modules: logger (via init), db, http-client, http-client2, filedatabase
 *
 * Run:
 *   npx tsx examples/comprehensive/show-used-params-all-modules.ts
 *   npx tsx examples/comprehensive/show-used-params-all-modules.ts --showUsedParams
 */

import { init } from "../../src/init/index.js";
import { Db } from "../../src/db/index.js";
import { HttpClient } from "../../src/http-client/index.js";
import { HttpClient as HttpClient2 } from "../../src/http-client2/index.js";
import { FileDatabase } from "../../src/filedatabase/index.js";

const flow = async (context: any) => {
  const { logger } = context;

  // Logger is already initialized by init()

  // Http-client: init pulls params for module "http-client"
  HttpClient.init(context);

  // Http-client2: init pulls params for module "http-client2"
  HttpClient2.init(context);

  // FileDatabase: init pulls params for module "filedatabase"
  FileDatabase.init(context, { basePath: "./data" });

  // Db: init pulls params for module "db" and attempts to connect
  try {
    await Db.init(context);
  } catch (err: any) {
    logger.warn("[Db] init failed (params were still read):", err?.message ?? err);
  }

  logger.info("All modules initialized. Run with --showUsedParams to see params at exit.");
};

init(flow);
