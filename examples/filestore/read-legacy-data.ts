#!/usr/bin/env node

import { FileDatabase } from "../../src/filedatabase.js";
import chalk from "chalk";
import path from "path";
import { fileURLToPath } from "url";

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Run with: npx tsx examples/filestore/read-legacy-data.ts
//
// Reading Legacy Data - demonstrates reading old format data without metadata.json
//
// This example shows:
// - Reading from legacy file structures (no metadata.json)
// - Optimized metadata building (only reads first + last files)
// - Reading large datasets efficiently
// - Handling different data tables

async function main() {
    console.info(chalk.yellow("📂 FileDatabase - Reading Legacy Data"));
    console.info(chalk.yellow("=".repeat(60)));
    console.info("");

    const legacyDataPath = path.resolve(__dirname, "data");

    console.info(chalk.cyan("Legacy Data Location:"));
    console.info(`  ${chalk.white(legacyDataPath)}`);
    console.info("");
    console.info(chalk.dim("Structure: basePath/namespace/tableName/version/files"));
    console.info(chalk.dim("Example:   data/harvested/beaches/members/2022-08-03T18:56:14Z/*.json"));
    console.info("");

    // Example 1: Read Members data (many files - 23 files)
    console.info(chalk.bold.green("✓ Reading Members Data (Optimized)"));
    console.info(chalk.dim("─".repeat(60)));

    const membersStore = new FileDatabase({
        basePath: legacyDataPath,
        namespace: "harvested",
        tableName: "beaches/members",  // Table can include subdirectories
        useMetadata: false,  // Legacy data doesn't have metadata.json
    });

    console.info(chalk.dim("  Note: Using optimized read (only first + last files)"));
    const startTime = Date.now();
    
    const membersData = await membersStore.read();
    const readTime = Date.now() - startTime;
    
    const membersMetadata = membersStore.getMetadata();
    console.info(`  ${chalk.bold("Version:")} ${chalk.green(membersMetadata.version)}`);
    console.info(`  ${chalk.bold("Files:")} ${chalk.white(membersMetadata.files.length)}`);
    console.info(`  ${chalk.bold("Total Records:")} ${chalk.white(membersMetadata.totalRecords.toLocaleString())}`);
    console.info(`  ${chalk.bold("Data Type:")} ${chalk.white(membersMetadata.dataType)}`);
    console.info(`  ${chalk.bold("Read Time:")} ${chalk.white(readTime + "ms")}`);
    console.info("");

    // Show some file details
    console.info(chalk.dim("  File Distribution:"));
    console.info(chalk.dim(`    First file: ${membersMetadata.files[0].fileName} → ${membersMetadata.files[0].recordsCount} records`));
    if (membersMetadata.files.length > 2) {
        console.info(chalk.dim(`    Middle files (${membersMetadata.files.length - 2}): ${membersMetadata.files[1].recordsCount} records each (assumed)`));
    }
    if (membersMetadata.files.length > 1) {
        const lastFile = membersMetadata.files[membersMetadata.files.length - 1];
        console.info(chalk.dim(`    Last file: ${lastFile.fileName} → ${lastFile.recordsCount} records`));
    }
    console.info("");

    // Show sample data
    if (membersData.length > 0) {
        console.info(chalk.dim("  Sample Record:"));
        const sampleKeys = Object.keys(membersData[0]).slice(0, 5);
        sampleKeys.forEach(key => {
            console.info(chalk.dim(`    ${key}: ${membersData[0][key]}`));
        });
        console.info(chalk.dim(`    ... (${Object.keys(membersData[0]).length - 5} more fields)`));
    }
    console.info("");

    // Example 2: Read Properties data (fewer files - 2 files in first version)
    console.info(chalk.bold.green("✓ Reading Properties Data"));
    console.info(chalk.dim("─".repeat(60)));

    const propertiesStore = new FileDatabase({
        basePath: legacyDataPath,
        namespace: "harvested",
        tableName: "beaches/properties",
        useMetadata: false,
    });

    // Read specific version
    const versions = await propertiesStore.getVersions();
    console.info(`  ${chalk.bold("Available Versions:")} ${chalk.white(versions.length)}`);
    versions.forEach((v, idx) => {
        console.info(chalk.dim(`    ${idx + 1}. ${v}`));
    });
    console.info("");

    // Read from first version with pagination (crossing file boundaries)
    console.info(`  ${chalk.bold("Reading Version:")} ${chalk.green(versions[0])} with pagination`);
    console.info(chalk.dim("  Page size: 4000 records (crosses file boundaries)"));
    console.info("");
    
    propertiesStore.resetPagination();
    let pageNum = 1;
    let totalRetrieved = 0;
    
    while (true) {
        const pageData = await propertiesStore.read({ 
            version: versions[0],  // Explicitly read from first version
            nextPage: pageNum > 1, 
            pageSize: 4000 
        });
        
        if (pageData.length === 0) break;
        
        // Find min and max ModificationTimestamp in this page
        const timestamps = pageData
            .map((record: any) => record.ModificationTimestamp)
            .filter((ts: any) => ts)
            .map((ts: string) => new Date(ts).getTime());
        
        const minTs = timestamps.length > 0 ? new Date(Math.min(...timestamps)).toISOString() : "N/A";
        const maxTs = timestamps.length > 0 ? new Date(Math.max(...timestamps)).toISOString() : "N/A";
        
        console.info(chalk.dim(`  Page ${pageNum}: ${pageData.length.toLocaleString()} records`));
        console.info(chalk.dim(`    Min timestamp: ${minTs}`));
        console.info(chalk.dim(`    Max timestamp: ${maxTs}`));
        
        totalRetrieved += pageData.length;
        pageNum++;
    }
    
    const propertiesMetadata = propertiesStore.getMetadata();
    console.info("");
    console.info(`  ${chalk.bold("Files:")} ${chalk.white(propertiesMetadata.files.length)}`);
    console.info(`  ${chalk.bold("Total Records:")} ${chalk.white(propertiesMetadata.totalRecords.toLocaleString())}`);
    console.info(`  ${chalk.bold("Total Retrieved:")} ${chalk.white(totalRetrieved.toLocaleString())}`);
    console.info("");

    // Example 3: Read XML data
    console.info(chalk.bold.green("✓ Reading XML Metadata"));
    console.info(chalk.dim("─".repeat(60)));

    const metaStore = new FileDatabase({
        basePath: legacyDataPath,
        namespace: "harvested",
        tableName: "beaches/meta",
        useMetadata: false,
    });

    const metaData = await metaStore.read();
    const metaMetadata = metaStore.getMetadata();
    
    console.info(`  ${chalk.bold("Version:")} ${chalk.green(metaMetadata.version)}`);
    console.info(`  ${chalk.bold("Files:")} ${chalk.white(metaMetadata.files.length)}`);
    console.info(`  ${chalk.bold("Data Type:")} ${chalk.white(metaMetadata.dataType)}`);
    console.info(`  ${chalk.bold("Content Length:")} ${chalk.white(typeof metaData === 'string' ? metaData.length + ' characters' : 'N/A')}`);
    console.info("");

    // Example 4: Paginated reading of legacy data
    console.info(chalk.bold.green("✓ Paginated Reading (100 records/page)"));
    console.info(chalk.dim("─".repeat(60)));

    membersStore.resetPagination();
    const page1 = await membersStore.read({ pageSize: 100 });
    console.info(`  ${chalk.bold("Page 1:")} ${chalk.white(page1.length)} records`);
    if (page1.length > 0) {
        console.info(chalk.dim(`    IDs: ${page1[0].MemberKey} - ${page1[page1.length - 1].MemberKey}`));
    }

    const page2 = await membersStore.read({ nextPage: true, pageSize: 100 });
    console.info(`  ${chalk.bold("Page 2:")} ${chalk.white(page2.length)} records`);
    if (page2.length > 0) {
        console.info(chalk.dim(`    IDs: ${page2[0].MemberKey} - ${page2[page2.length - 1].MemberKey}`));
    }
    console.info("");

    // Summary
    console.info(chalk.green("🎉 Legacy data reading completed!"));
    console.info("");
    console.info(chalk.yellow("Key Points:"));
    console.info(chalk.dim("  • Optimized reading only loads first + last files for metadata"));
    console.info(chalk.dim("  • Assumes middle files have same count as first file"));
    console.info(chalk.dim("  • Works with JSON arrays, XML, and text files"));
    console.info(chalk.dim("  • No metadata.json files needed"));
    console.info(chalk.dim("  • Full pagination support"));
    console.info("");
}

main().catch((error) => {
    console.error(chalk.red("❌ Error:"), error.message);
    if (error.stack) {
        console.error(chalk.dim(error.stack));
    }
    process.exit(1);
});

