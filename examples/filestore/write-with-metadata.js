#!/usr/bin/env node

import { init } from "../../src/init/index.js";
import { FileDatabase } from "../../src/filedatabase/index.js";
import chalk from "chalk";

// npx tsx examples/filestore/write-with-metadata.ts --data="first listing" --ListingId=1
// npx tsx examples/filestore/write-with-metadata.ts --data="second listing" --ListingId=2
// npx tsx examples/filestore/write-with-metadata.ts --basePath="./testData" --namespace="test" --tableName="records" --data="Test data" --ListingId="67890"

const flow = async (context) => {
    const { logger, params } = context;

    logger.info(chalk.yellow("📝 FileDatabase Write with Custom Metadata Example"));
    logger.info(chalk.yellow("=".repeat(60)));
    logger.info("");

    // Get CLI parameters with defaults
    const defs = {
        basePath: "string default ./examples/filestore/data",
        namespace: "string default test",
        tableName: "string default records",
        data: "string required",
        ListingId: "string required",
    };

    const { basePath, namespace, tableName, data, ListingId } = params.getAll(defs);

    logger.info(chalk.cyan("Configuration:"));
    logger.info(`  Base Path: ${chalk.white(basePath)}`);
    logger.info(`  Namespace: ${chalk.white(namespace)}`);
    logger.info(`  Table Name: ${chalk.white(tableName)}`);
    logger.info(`  ListingId: ${chalk.white(ListingId)}`);
    logger.info(`  Data: ${chalk.white(data)}`);
    logger.info("");

    // Initialize FileDatabase with non-versioned mode
    const fileDb = FileDatabase.init(context, {
        basePath,
        namespace,
        tableName,
        versioned: false, // Non-versioned for test data
        useMetadata: true,
    });

    // Prepare data object
    const recordData = {
        data: data,
        ListingId: ListingId,
    };

    logger.info(chalk.bold.green("✓ Writing record with custom metadata"));
    logger.info(chalk.dim("─".repeat(60)));

    // Write the record with custom metadata
    await fileDb.write(recordData, {
        customMetadata: {
            ListingId: ListingId,
        },
    });

    logger.info(`  ${chalk.green("✓ Record written successfully")}`);
    logger.info(`  ${chalk.dim("File location:")} ${chalk.white(`${basePath}/${namespace}/${tableName}/`)}`);

    // Get metadata to show what was saved
    const metadata = fileDb.getMetadata();
    if (metadata.files.length > 0) {
        const fileEntry = metadata.files[metadata.files.length - 1];
        logger.info(`  ${chalk.dim("File name:")} ${chalk.white(fileEntry.fileName)}`);
        logger.info(`  ${chalk.dim("Metadata:")} ${chalk.white(JSON.stringify({ ListingId: fileEntry.ListingId, recordsCount: fileEntry.recordsCount }))}`);
    }

    logger.info("");
    logger.info(chalk.green("🎉 Write operation completed!"));
    logger.info("");
    logger.info(chalk.dim("💡 You can now search for this record using:"));
    logger.info(chalk.dim(`  npx tsx examples/filestore/search-by-metadata.ts --ListingId="${ListingId}"`));
    logger.info("");
};

init(flow, {
    modules: ["logger"],
});

