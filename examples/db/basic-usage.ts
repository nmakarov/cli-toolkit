#!/usr/bin/env node

import { Db } from "../../src/db.js";
import chalk from "chalk";

// Run with: npx tsx examples/db/basic-usage.ts
// Or with custom connection string: DB_CONNECTION_STRING='postgresql://user:pass@localhost:5432/mydb' npx tsx examples/db/basic-usage.ts
//
// Db Basic Usage - demonstrates low-level SQL database operations with Knex
//
// This example shows:
// - Creating a Db instance with connection configuration
// - Using db() directly like a Knex instance: db('table').select()
// - Accessing Knex methods: db.schema, db.raw, db.transaction()
// - Connection management: connect(), disconnect(), testConnection()
// - Query profiling and logging
// - Utility methods: tableExists(), getQueryLog()

async function main() {
    console.info(chalk.yellow("🗄️  Db Basic Usage Example"));
    console.info(chalk.yellow("=".repeat(50)));
    console.info("");

    // Example connection string (replace with your actual database)
    // PostgreSQL: postgresql://user:password@localhost:5432/dbname
    // MySQL: mysql://user:password@localhost:3306/dbname
    const connectionString = process.env.DB_CONNECTION_STRING || "postgresql://root:root@localhost:6032/mlsfarm";

    if (connectionString === "postgresql://user:pass@localhost:5432/testdb") {
        console.warn(chalk.yellow("⚠️  Using default connection string. Set DB_CONNECTION_STRING env var to use your database."));
        console.warn(chalk.yellow("   Example: DB_CONNECTION_STRING='postgresql://user:pass@localhost:5432/mydb' npx tsx examples/db/basic-usage.ts"));
        console.info("");
    }

    const db = new Db({
        connectionString,
        name: "example-db",
        testConnection: true,
        profile: true, // Enable query profiling
        logger: {
            debug: (msg: string) => console.info(chalk.dim(`[DB] ${msg}`)),
            warn: (msg: string) => console.warn(chalk.yellow(`[DB] ${msg}`)),
            error: (msg: string) => console.error(chalk.red(`[DB] ${msg}`)),
        },
    });

    try {
        // Example 1: Connect to database
        console.info(chalk.bold.green("✓ Example 1: Connecting to database"));
        console.info(chalk.dim("─".repeat(50)));
        await db.connect();
        console.info(`  ${chalk.green("✓ Connected successfully")}`);
        console.info("");

        // Example 2: Use db directly like Knex - SELECT query
        console.info(chalk.bold.blue("✓ Example 2: Using db() like Knex"));
        console.info(chalk.dim("─".repeat(50)));
        console.info("  You can use db('table') exactly like a Knex instance:");
        console.info(chalk.dim('  const users = await db("users").select("*");'));
        console.info(chalk.dim('  await db("posts").insert({ title: "Hello" });'));
        console.info(chalk.dim('  await db("users").where({ id: 1 }).update({ name: "John" });'));
        console.info("");

        // Example 3: Access Knex methods directly
        console.info(chalk.bold.magenta("✓ Example 3: Accessing Knex methods"));
        console.info(chalk.dim("─".repeat(50)));
        console.info("  All Knex methods are available:");
        console.info(chalk.dim('  db.schema.hasTable("users")'));
        console.info(chalk.dim('  db.raw("SELECT NOW()")'));
        console.info(chalk.dim('  db.transaction(async (trx) => { ... })'));
        console.info("");

        // Example 4: Check if table exists
        console.info(chalk.bold.yellow("✓ Example 4: Utility methods"));
        console.info(chalk.dim("─".repeat(50)));
        const tableName = "example_table";
        const exists = await db.tableExists(tableName);
        console.info(`  Table "${tableName}" exists: ${exists ? chalk.green("Yes") : chalk.red("No")}`);
        console.info("");

        // Example 5: Query profiling
        console.info(chalk.bold.cyan("✓ Example 5: Query profiling"));
        console.info(chalk.dim("─".repeat(50)));
        if (db.isConnectedToDb()) {
            // Execute a test query
            try {
                await db.raw("SELECT 1 as test");
                const queryLog = db.getQueryLog();
                console.info(`  Queries executed: ${queryLog.length}`);
                if (queryLog.length > 0) {
                    console.info(`  Last query: ${chalk.dim(queryLog[queryLog.length - 1].sql)}`);
                    console.info(`  Duration: ${chalk.dim(queryLog[queryLog.length - 1].executionTimeMs)}ms`);
                }
            } catch (error: any) {
                console.warn(chalk.yellow(`  Could not execute test query: ${error.message}`));
            }
        }
        console.info("");

    } catch (error: any) {
        console.error(chalk.red("❌ Error:"), error.message);
        if (error.message.includes("ECONNREFUSED") || error.message.includes("ENOTFOUND")) {
            console.error(chalk.yellow("\n💡 Tip: Make sure your database is running and the connection string is correct."));
        }
    } finally {
        // Example 6: Disconnect
        console.info(chalk.bold("🧹 Cleanup"));
        console.info(chalk.dim("─".repeat(50)));
        try {
            await db.disconnect();
            console.info(`  ${chalk.green("✓ Disconnected successfully")}`);
        } catch (error: any) {
            console.error(`  ${chalk.red("✗ Error disconnecting:")} ${error.message}`);
        }
        console.info("");
        console.info(chalk.green("🎉 Db demonstration completed!"));
        console.info("");
        console.info(chalk.dim("💡 Key Features Demonstrated:"));
        console.info(chalk.dim("  • Callable instance: db('table').select()"));
        console.info(chalk.dim("  • Direct Knex method access: db.schema, db.raw, etc."));
        console.info(chalk.dim("  • Connection management: connect(), disconnect()"));
        console.info(chalk.dim("  • Query profiling and logging"));
        console.info(chalk.dim("  • Utility methods: tableExists(), testConnection()"));
        console.info("");
    }
}

main().catch((error) => {
    console.error(chalk.red("❌ Fatal error:"), error);
    process.exit(1);
});

