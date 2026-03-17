#!/usr/bin/env node

import path from "path";
import { init } from "../../src/init/index.js";
import { FileDatabase } from "../../src/filedatabase.js";
import chalk from "chalk";

// Run with: npx tsx examples/filestore/search-by-metadata.ts --ListingId="1"
// (uses default basePath=./examples/filestore/data where the example data lives)
// Or with custom path: npx tsx examples/filestore/search-by-metadata.ts --basePath="./examples/filestore/data" --namespace="test" --tableName="records" --ListingId="67890"
// Note: basePath is resolved from the current working directory. Use the same basePath you used when writing.

const flow = async (context) => {
    const { logger, params } = context;

    logger.info(chalk.yellow("🔍 FileDatabase Search by Custom Metadata Example"));
    logger.info(chalk.yellow("=".repeat(60)));
    logger.info("");

    // Get CLI parameters with defaults (matching write script)
    const defs = {
        basePath: "string default ./examples/filestore/data",
        namespace: "string default test",
        tableName: "string default records",
        ListingId: "string required",
    };

    const { basePath, namespace, tableName, ListingId } = params.getAll(defs);

    logger.info(chalk.cyan("Search Configuration:"));
    logger.info(`  Base Path: ${chalk.white(basePath)}`);
    logger.info(`  Namespace: ${chalk.white(namespace)}`);
    logger.info(`  Table Name: ${chalk.white(tableName)}`);
    logger.info(`  Search Criteria: ${chalk.white(`ListingId="${ListingId}"`)}`);
    logger.info("");

    // Initialize FileDatabase with non-versioned mode (matching write script)
    const fileDb = FileDatabase.init(context, {
        basePath,
        namespace,
        tableName,
        versioned: false, // Non-versioned for test data
        useMetadata: true,
    });

    // Resolved table path (basePath is relative to cwd)
    const resolvedPath = path.resolve(basePath, namespace, tableName);
    logger.info(chalk.dim(`  Resolved table path: ${resolvedPath}`));
    logger.info("");

    logger.info(chalk.bold.blue("🔍 Searching for records..."));
    logger.info(chalk.dim("─".repeat(60)));

    try {
        // Search for records matching the ListingId
        const results = await fileDb.findData({ ListingId: ListingId });

        if (results.length === 0) {
            logger.warn(chalk.yellow(`⚠️  No records found with ListingId: ${ListingId}`));
            logger.info("");
            logger.info(chalk.dim("💡 Make sure you've written a record first using:"));
            logger.info(chalk.dim(`  npx tsx examples/filestore/write-with-metadata.ts --data="Your data" --ListingId="${ListingId}"`));
            logger.info("");
            return;
        }

        logger.info(chalk.green(`✓ Found ${results.length} record(s)`));
        logger.info("");

        // Display each found record
        results.forEach((result, index) => {
            logger.info(chalk.bold.cyan(`Record ${index + 1}:`));
            logger.info(chalk.dim("─".repeat(60)));
            logger.info(`  ${chalk.dim("File Path:")} ${chalk.white(result.filePath)}`);
            logger.info(`  ${chalk.dim("File Name:")} ${chalk.white(result.fileName)}`);
            logger.info(`  ${chalk.dim("Version:")} ${chalk.white(result.version || "non-versioned")}`);
            logger.info(`  ${chalk.dim("Metadata:")} ${chalk.white(JSON.stringify(result.metadata, null, 2).split('\n').join('\n  '))}`);
            logger.info(`  ${chalk.dim("Data:")}`);
            logger.info(chalk.white(JSON.stringify(result.data, null, 2).split('\n').map(line => `  ${line}`).join('\n')));
            logger.info("");
        });

        logger.info(chalk.green("🎉 Search completed!"));
        logger.info("");

    } catch (error: any) {
        logger.error(chalk.red("❌ Error during search:"), error.message);
        if (error.stack) {
            logger.error(chalk.dim(error.stack));
        }
    }
};

init(flow, {
    modules: ["logger"],
});

