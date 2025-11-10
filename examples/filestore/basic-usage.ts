#!/usr/bin/env node

import { FileDatabase } from "../../src/filedatabase.js";
import chalk from "chalk";
import path from "path";
import { fileURLToPath } from "url";

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Run with: npx tsx examples/filestore/basic-usage.ts
//
// FileDatabase Basic Usage - demonstrates versioned file storage
//
// This example shows:
// - Creating a FileDatabase instance
// - Writing data with automatic versioning
// - Reading data back with pagination
// - Managing multiple versions
// - Viewing metadata

async function main() {
    console.info(chalk.yellow("📦 FileDatabase Basic Usage Example"));
    console.info(chalk.yellow("=".repeat(50)));
    console.info("");

    // Create FileDatabase instance
    const dataPath = path.resolve(__dirname, "data");
    const store = new FileDatabase({
        basePath: dataPath,
        namespace: "demo",
        tableName: "products",
        pageSize: 100, // 100 records per file
        maxVersions: 5, // Keep last 5 versions
        useMetadata: true,
    });

    console.info(chalk.cyan("Configuration:"));
    console.info(`  Base Path: ${chalk.white(dataPath)}`);
    console.info(`  Namespace: ${chalk.white("demo")}`);
    console.info(`  Table: ${chalk.white("products")}`);
    console.info(`  Page Size: ${chalk.white("100 records/file")}`);
    console.info(`  Max Versions: ${chalk.white("5")}`);
    console.info("");

    // Example 1: Write data (first version)
    console.info(chalk.bold.green("✓ Writing Version 1 (250 products)"));
    console.info(chalk.dim("─".repeat(50)));

    const productsV1 = Array.from({ length: 250 }, (_, i) => ({
        id: i + 1,
        name: `Product ${i + 1}`,
        price: Math.round((Math.random() * 100 + 10) * 100) / 100,
        category: ["Electronics", "Clothing", "Home", "Sports"][Math.floor(Math.random() * 4)],
        inStock: Math.random() > 0.3,
    }));

    await store.write(productsV1);

    const v1 = store.getCurrentVersion();
    console.info(`  ${chalk.bold("Version:")} ${chalk.green(v1)}`);

    const metadataV1 = store.getMetadata();
    console.info(`  ${chalk.bold("Files Created:")} ${chalk.white(metadataV1.files.length)}`);
    console.info(`  ${chalk.bold("Total Records:")} ${chalk.white(metadataV1.totalRecords)}`);
    console.info(`  ${chalk.bold("Data Type:")} ${chalk.white(metadataV1.dataType)}`);
    console.info("");

    metadataV1.files.forEach((file, idx) => {
        console.info(
            `    ${chalk.gray(`File ${idx + 1}:`)} ${chalk.white(file.fileName)} ${chalk.gray("→")} ${chalk.white(file.recordsCount)} records`
        );
    });
    console.info("");

    // Example 2: Read all data
    console.info(chalk.bold.green("✓ Reading All Data"));
    console.info(chalk.dim("─".repeat(50)));

    const allProducts = await store.read();
    console.info(`  Retrieved ${chalk.white(allProducts.length)} records`);
    console.info(
        `  First Product: ${chalk.white(JSON.stringify(allProducts[0]))}`
    );
    console.info(
        `  Last Product: ${chalk.white(JSON.stringify(allProducts[allProducts.length - 1]))}`
    );
    console.info("");

    // Example 3: Paginated reading
    console.info(chalk.bold.green("✓ Paginated Reading (50 records/page)"));
    console.info(chalk.dim("─".repeat(50)));

    store.resetPagination();
    const page1 = await store.read({ nextPage: false, pageSize: 50 });
    console.info(`  Page 1: ${chalk.white(page1.length)} records (IDs ${page1[0].id} - ${page1[page1.length - 1].id})`);

    const page2 = await store.read({ nextPage: true, pageSize: 50 });
    console.info(`  Page 2: ${chalk.white(page2.length)} records (IDs ${page2[0].id} - ${page2[page2.length - 1].id})`);

    const page3 = await store.read({ nextPage: true, pageSize: 50 });
    console.info(`  Page 3: ${chalk.white(page3.length)} records (IDs ${page3[0].id} - ${page3[page3.length - 1].id})`);
    console.info("");

    // Example 4: Create a new version
    console.info(chalk.bold.green("✓ Writing Version 2 (150 products)"));
    console.info(chalk.dim("─".repeat(50)));

    const productsV2 = Array.from({ length: 150 }, (_, i) => ({
        id: i + 1,
        name: `Updated Product ${i + 1}`,
        price: Math.round((Math.random() * 150 + 20) * 100) / 100,
        category: ["Electronics", "Books", "Toys"][Math.floor(Math.random() * 3)],
        inStock: true,
    }));

    await store.write(productsV2, { forceNewVersion: true });

    const v2 = store.getCurrentVersion();
    console.info(`  ${chalk.bold("Version:")} ${chalk.green(v2)}`);

    const metadataV2 = store.getMetadata();
    console.info(`  ${chalk.bold("Total Records:")} ${chalk.white(metadataV2.totalRecords)}`);
    console.info("");

    // Example 5: List all versions
    console.info(chalk.bold.green("✓ Available Versions"));
    console.info(chalk.dim("─".repeat(50)));

    const versions = await store.getVersions();
    versions.forEach((version, idx) => {
        const marker = version === v2 ? chalk.green("← current") : "";
        console.info(`  ${idx + 1}. ${chalk.white(version)} ${marker}`);
    });
    console.info("");

    // Example 6: Read from specific version
    console.info(chalk.bold.green("✓ Reading from Version 1"));
    console.info(chalk.dim("─".repeat(50)));

    const v1Data = await store.read({ version: v1! });
    console.info(`  Retrieved ${chalk.white(v1Data.length)} records from ${chalk.green(v1)}`);
    console.info(`  First: ${chalk.white(JSON.stringify(v1Data[0]))}`);
    console.info("");

    // Example 7: Custom synopsis functions
    console.info(chalk.bold.green("✓ Using Synopsis Functions"));
    console.info(chalk.dim("─".repeat(50)));

    const storeWithSynopsis = new FileDatabase({
        basePath: dataPath,
        namespace: "demo",
        tableName: "products-with-synopsis",
        pageSize: 100,
        useMetadata: true,
    });

    // File-level synopsis: track min/max prices
    storeWithSynopsis.setFileSynopsisFunction((fileEntry, data) => {
        if (Array.isArray(data) && data.length > 0) {
            const prices = data.map((item: any) => item.price);
            return {
                ...fileEntry,
                minPrice: Math.min(...prices),
                maxPrice: Math.max(...prices),
            };
        }
        return fileEntry;
    });

    // Version-level synopsis: aggregate across all files
    storeWithSynopsis.setVersionSynopsisFunction((metadata) => {
        const allMinPrices = metadata.files.map((f: any) => f.minPrice).filter(Boolean);
        const allMaxPrices = metadata.files.map((f: any) => f.maxPrice).filter(Boolean);

        return {
            ...metadata,
            synopsis: {
                globalMinPrice: allMinPrices.length ? Math.min(...allMinPrices) : null,
                globalMaxPrice: allMaxPrices.length ? Math.max(...allMaxPrices) : null,
                fileCount: metadata.files.length,
                averageRecordsPerFile: metadata.totalRecords / metadata.files.length,
            },
        };
    });

    await storeWithSynopsis.write(productsV1);

    const synopsisMetadata = storeWithSynopsis.getMetadata();
    console.info(`  ${chalk.bold("Global Min Price:")} ${chalk.white(`$${synopsisMetadata.synopsis.globalMinPrice.toFixed(2)}`)}`);
    console.info(`  ${chalk.bold("Global Max Price:")} ${chalk.white(`$${synopsisMetadata.synopsis.globalMaxPrice.toFixed(2)}`)}`);
    console.info(`  ${chalk.bold("File Count:")} ${chalk.white(synopsisMetadata.synopsis.fileCount)}`);
    console.info(`  ${chalk.bold("Avg Records/File:")} ${chalk.white(synopsisMetadata.synopsis.averageRecordsPerFile.toFixed(1))}`);
    console.info("");

    // Example 6: Non-versioned mode (for single objects, API responses, etc.)
    console.info(chalk.bold.magenta("📄 Example 6: Non-Versioned Mode"));
    console.info(chalk.dim("─".repeat(50)));

    const nonVersionedStore = new FileDatabase({
        basePath: dataPath,
        namespace: "demo",
        tableName: "api-responses",
        versioned: false, // No timestamp folders
        useMetadata: true,
    });

    console.info(chalk.cyan("Configuration:"));
    console.info(`  Mode: ${chalk.white("Non-versioned (single objects)")}`);
    console.info(`  Table: ${chalk.white("api-responses")}`);
    console.info("");

    // Write an API response (single object)
    const apiResponse = {
        id: "user-123",
        email: "user@example.com",
        name: "John Doe",
        createdAt: new Date().toISOString(),
        status: "active",
        roles: ["admin", "user"]
    };

    await nonVersionedStore.write(apiResponse);

    // Check if data exists
    const hasData = await nonVersionedStore.hasData();
    console.info(`  ${chalk.bold("Has Data:")} ${chalk.white(hasData ? "Yes" : "No")}`);

    // Read back the API response
    const readResponse = await nonVersionedStore.read();
    console.info(`  ${chalk.bold("User ID:")} ${chalk.white(readResponse.id)}`);
    console.info(`  ${chalk.bold("Email:")} ${chalk.white(readResponse.email)}`);
    console.info(`  ${chalk.bold("Status:")} ${chalk.white(readResponse.status)}`);
    console.info(`  ${chalk.bold("Roles:")} ${chalk.white(readResponse.roles.join(", "))}`);
    console.info("");

    // Demonstrate data format detection
    const format = await nonVersionedStore.detectDataFormat();
    console.info(`  ${chalk.bold("Detected Format:")} ${chalk.white(format.versioned ? "Versioned" : "Non-versioned")}`);
    console.info(`  ${chalk.bold("Has Metadata:")} ${chalk.white(format.hasMetadata ? "Yes" : "No")}`);
    console.info(`  ${chalk.bold("Data Type:")} ${chalk.white(format.dataType || "Unknown")}`);
    console.info("");

    console.info(chalk.green("🎉 FileDatabase demonstration completed!"));
    console.info("");
    console.info(chalk.yellow("Data Location:"));
    console.info(`  ${chalk.dim(dataPath)}`);
    console.info("");
    console.info(chalk.dim("💡 Key Features Demonstrated:"));
    console.info(chalk.dim("  • Automatic versioning with timestamp folders"));
    console.info(chalk.dim("  • Chunked file writes for large datasets"));
    console.info(chalk.dim("  • Pagination for efficient reading"));
    console.info(chalk.dim("  • Metadata tracking with custom synopsis functions"));
    console.info(chalk.dim("  • Non-versioned mode for single objects"));
    console.info(chalk.dim("  • Automatic data format detection"));
    console.info("");
}

main().catch((error) => {
    console.error(chalk.red("❌ Error:"), error.message);
    process.exit(1);
});

