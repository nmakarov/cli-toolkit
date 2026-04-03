#!/usr/bin/env node

import { init } from "../../src/init/index.js";
import { Db } from "../../src/db.js";
import chalk from "chalk";

// Run with: npx tsx examples/db/basic-usage.ts
// Or with custom connection string: DB_CONNECTION_STRING='postgresql://user:pass@localhost:5432/mydb' npx tsx examples/db/basic-usage.ts
//
// Db Basic Usage - demonstrates low-level SQL database operations with Knex
//
// This example shows:
// - Using Db.init() with context (module pattern)
// - Using db() directly like a Knex instance: db('table').select()
// - Accessing Knex methods: db.schema, db.raw, db.transaction()
// - Connection management: connect(), disconnect(), testConnection()
// - Query profiling and logging
// - Utility methods: tableExists(), getQueryLog()

const flow = async (context) => {
    const { logger } = context;

    logger.info(chalk.yellow("🗄️  Db Basic Usage Example"));
    logger.info(chalk.yellow("=".repeat(50)));
    logger.info("");

    // Example 1: Using Db.init with context (module pattern - auto-connects)
    logger.info(chalk.bold.green("✓ Example 1: Using Db.init with context"));
    logger.info(chalk.dim("─".repeat(50)));
    logger.info("  Db.init() can read from params (getAllForModule('db', defs)) or accept a second parameter");
    logger.info("  (connection string or dbName) and automatically connects to the database");
    logger.info("");
    
    // Option 1: Db.init(context) - reads from params
    // Option 2: Db.init(context, 'dbName') - resolves dbName to dbConnectionString${Name}
    // Option 3: Db.init(context, 'postgresql://...') - direct connection string
    const connectionString = process.env.DB_CONNECTION_STRING || "postgresql://root:root@localhost:6032/mlsfarm";
    
    // const db = await Db.init(context, connectionString);
    const db = await Db.init(context);

    try {
        // dbFindAndConnect already connected, so we skip the connect step
        logger.info(`  ${chalk.green("✓ Connected successfully")}`);
        logger.info("");

        // Example 2: Using db() like Knex

        logger.info("  You can use db('table') exactly like a Knex instance:");
        logger.info(chalk.dim('  const users = await db("users").select("*");'));
        logger.info(chalk.dim('  await db("posts").insert({ title: "Hello" });'));
        logger.info(chalk.dim('  await db("users").where({ id: 1 }).update({ name: "John" });'));
        logger.info("");

        // Example 3: Access Knex methods directly
        logger.info(chalk.bold.magenta("✓ Example 3: Accessing Knex methods"));
        logger.info(chalk.dim("─".repeat(50)));
        logger.info("  All Knex methods are available:");
        logger.info(chalk.dim('  db.schema.hasTable("users")'));
        logger.info(chalk.dim('  db.raw("SELECT NOW()")'));
        logger.info(chalk.dim('  db.transaction(async (trx) => { ... })'));
        logger.info("");

        // Example 4: Check if table exists
        logger.info(chalk.bold.yellow("✓ Example 4: Utility methods"));
        logger.info(chalk.dim("─".repeat(50)));
        const tableName = "example_table";
        const exists = await db.tableExists(tableName);
        logger.info(`  Table "${tableName}" exists: ${exists ? chalk.green("Yes") : chalk.red("No")}`);
        logger.info("");

        // Example 5: Query profiling
        logger.info(chalk.bold.cyan("✓ Example 5: Query profiling"));
        logger.info(chalk.dim("─".repeat(50)));

        // db.attachProfiler();

        if (db.isConnectedToDb()) {
            // Execute a test query
            try {
                await (db as any).raw("SELECT 1 as test");
                const queryLog = db.getQueryLog();
                logger.info(`  Queries executed: ${queryLog.length}`);
                if (queryLog.length > 0) {
                    logger.info(`  Last query: ${chalk.dim(queryLog[queryLog.length - 1].sql)}`);
                    logger.info(`  Duration: ${chalk.dim(queryLog[queryLog.length - 1].executionTimeMs)}ms`);
                }
            } catch (error: any) {
                logger.warn(chalk.yellow(`  Could not execute test query: ${error.message}`));
            }
        }
        logger.info("");

    } catch (error: any) {
        logger.error(chalk.red("❌ Error:"), error.message);
        if (error.message.includes("ECONNREFUSED") || error.message.includes("ENOTFOUND")) {
            logger.error(chalk.yellow("\n💡 Tip: Make sure your database is running and the connection string is correct."));
        }
    } finally {
        // Example 6: Disconnect
        logger.info(chalk.bold("🧹 Cleanup"));
        logger.info(chalk.dim("─".repeat(50)));
        try {
            await db.disconnect();
            logger.info(`  ${chalk.green("✓ Disconnected successfully")}`);
        } catch (error: any) {
            logger.error(`  ${chalk.red("✗ Error disconnecting:")} ${error.message}`);
        }
        logger.info("");
        logger.info(chalk.green("🎉 Db demonstration completed!"));
        logger.info("");
        logger.info(chalk.dim("💡 Key Features Demonstrated:"));
        logger.info(chalk.dim("  • Db.init() with context (module pattern)"));
        logger.info(chalk.dim("  • Db.init(context, dbNameOrConnectionString) - optional second parameter"));
        logger.info(chalk.dim("  • Database name resolution (dbName -> dbConnectionString${Name})"));
        logger.info(chalk.dim("  • Dedicated dbConnect() function for better error handling"));
        logger.info(chalk.dim("  • Automatic cleanup registration"));
        logger.info(chalk.dim("  • Callable instance: db('table').select()"));
        logger.info(chalk.dim("  • Direct Knex method access: db.schema, db.raw, etc."));
        logger.info(chalk.dim("  • Auto-connection on init"));
        logger.info(chalk.dim("  • Query profiling and logging"));
        logger.info(chalk.dim("  • Utility methods: tableExists(), testConnection()"));
        logger.info("");
    }
};

init(flow, {
    mode: "text",
    route: "console",
    modules: ["logger"],
});

