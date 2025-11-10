#!/usr/bin/env node

import { FileDatabase } from "../../src/filedatabase.js";
import { Args } from "../../src/args.js";
import { Params } from "../../src/params.js";
import chalk from "chalk";
import path from "path";
import { fileURLToPath } from "url";

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Run with: npx tsx examples/filestore/inspect-data.ts --basePath=examples/filestore/data --namespace=harvested --tableName=beaches/properties
// npx tsx examples/filestore/inspect-data.ts --basePath=/Users/nmakarov/Projects/DataLoft/mlsfarm/data --namespace=harvested --tableName=beaches/meta
// npx tsx examples/filestore/inspect-data.ts --basePath=/Users/nmakarov/Projects/DataLoft/mlsfarm/data --namespace=harvested --tableName=beaches/members
//
// Inspect Data - analyzes and reports statistics about stored data
//
// This example shows:
// - Using Params to accept command-line arguments
// - Automatically detecting data type (json-array, json-object, text, xml)
// - Calculating statistics based on data type
// - Handling different data structures intelligently

async function main() {
    // Create Args instance
    const args = new Args();
    
    // Define parameter definitions  
    const params = new Params({ args });
    const { basePath, namespace, tableName, version } = params.getAll({
        basePath: `string default ${path.resolve(__dirname, "data")}`,
        namespace: "string default harvested",
        tableName: "string default beaches/members",
        version: "string", // Optional - uses latest if not specified
    });

    console.info(chalk.yellow("🔍 FileDatabase - Data Inspector"));
    console.info(chalk.yellow("=".repeat(60)));
    console.info("");

    console.info(chalk.cyan("Configuration:"));
    console.info(`  ${chalk.bold("Base Path:")} ${chalk.white(basePath)}`);
    console.info(`  ${chalk.bold("Namespace:")} ${chalk.white(namespace)}`);
    console.info(`  ${chalk.bold("Table Name:")} ${chalk.white(tableName)}`);
    if (version) {
        console.info(`  ${chalk.bold("Version:")} ${chalk.white(version)}`);
    }
    console.info("");

    // Initialize FileDatabase
    const store = new FileDatabase({
        basePath,
        namespace,
        tableName,
        useMetadata: false, // Work with legacy data
    });

    // Get available versions
    // TODO: Add store.hasData() method to detect if data exists (versioned or non-versioned)
    // TODO: Add store.getLatestVersion() method instead of versions[versions.length - 1]
    // TODO: Handle non-versioned data (metadata.json without version folders)
    const versions = await store.getVersions();
    
    if (versions.length === 0) {
        console.error(chalk.red("❌ No data found at specified location"));
        console.error(chalk.dim("Note: Currently only supports versioned data with timestamp folders"));
        process.exit(1);
    }

    console.info(chalk.bold.green("✓ Data Discovery"));
    console.info(chalk.dim("─".repeat(60)));
    console.info(`  ${chalk.bold("Available Versions:")} ${chalk.white(versions.length)}`);
    
    versions.forEach((v, idx) => {
        const marker = (!version && idx === versions.length - 1) ? chalk.green("← latest") : "";
        console.info(chalk.dim(`    ${idx + 1}. ${v} ${marker}`));
    });
    console.info("");

    // Read data from specified or latest version
    // Using versions[versions.length - 1] for now - should use getLatestVersion() in future
    const targetVersion = version || versions[versions.length - 1];
    console.info(chalk.bold.cyan(`📊 Analyzing Version: ${targetVersion}`));
    console.info(chalk.dim("─".repeat(60)));

    // Prepare store for reading to get metadata
    await store.prepare({ read: true, version: targetVersion });
    const metadata = store.getMetadata();

    // Display basic metadata
    console.info(`  ${chalk.bold("Data Type:")} ${chalk.white(metadata.dataType)}`);
    console.info(`  ${chalk.bold("Files:")} ${chalk.white(metadata.files.length)}`);
    console.info(`  ${chalk.bold("Total Records:")} ${chalk.white(metadata.totalRecords.toLocaleString())}`);
    console.info("");

    // Type-specific analysis
    switch (metadata.dataType) {
        case "json-array":
            // For arrays, use pagination to avoid loading everything into memory
            await analyzeJsonArray(store, targetVersion, metadata.totalRecords);
            break;
        
        case "json-object":
            // For objects, it's a single record - safe to load
            const startTime1 = Date.now();
            const objData = await store.read({ version: targetVersion });
            const readTime1 = Date.now() - startTime1;
            console.info(`  ${chalk.bold("Read Time:")} ${chalk.white(readTime1 + "ms")}`);
            console.info("");
            analyzeJsonObject(objData as Record<string, any>);
            break;
        
        case "text":
            // For text, load and analyze
            const startTime2 = Date.now();
            const textData = await store.read({ version: targetVersion });
            const readTime2 = Date.now() - startTime2;
            console.info(`  ${chalk.bold("Read Time:")} ${chalk.white(readTime2 + "ms")}`);
            console.info("");
            analyzeText(textData as string);
            break;
        
        case "xml":
            // For XML, load and analyze
            const startTime3 = Date.now();
            const xmlData = await store.read({ version: targetVersion });
            const readTime3 = Date.now() - startTime3;
            console.info(`  ${chalk.bold("Read Time:")} ${chalk.white(readTime3 + "ms")}`);
            console.info("");
            analyzeXml(xmlData as string);
            break;
        
        default:
            console.info(chalk.yellow(`  Unknown data type: ${metadata.dataType}`));
    }

    console.info("");
    console.info(chalk.green("✨ Inspection complete!"));
    console.info("");
}

/**
 * Analyze JSON array data - calculate statistics using pagination
 */
async function analyzeJsonArray(store: FileDatabase, version: string, totalRecords: number) {
    console.info(chalk.bold.magenta("📋 JSON Array Analysis"));
    console.info(chalk.dim("─".repeat(60)));

    if (totalRecords === 0) {
        console.info(chalk.yellow("  No records found"));
        return;
    }

    console.info(chalk.dim(`  Analyzing ${totalRecords.toLocaleString()} records using pagination...`));
    console.info("");

    const startTime = Date.now();
    
    // Field analysis - collect all unique fields
    const fieldCounts = new Map<string, number>();
    const fieldTypes = new Map<string, Set<string>>();
    const numericFieldValues = new Map<string, number[]>();
    const dateFieldValues = new Map<string, number[]>();
    const sampleRecords: any[] = [];
    
    // Read in chunks to avoid memory issues
    const CHUNK_SIZE = 5000;
    let recordsProcessed = 0;
    
    store.resetPagination();
    
    while (recordsProcessed < totalRecords) {
        const chunk = await store.read({ 
            version,
            nextPage: recordsProcessed > 0, 
            pageSize: CHUNK_SIZE 
        });
        
        if (chunk.length === 0) break;
        
        // Collect samples from first chunk only
        if (sampleRecords.length < 3 && chunk.length > 0) {
            sampleRecords.push(...chunk.slice(0, Math.min(3 - sampleRecords.length, chunk.length)));
        }
        
        for (const record of chunk) {
            for (const [key, value] of Object.entries(record)) {
                fieldCounts.set(key, (fieldCounts.get(key) || 0) + 1);
                
                if (!fieldTypes.has(key)) {
                    fieldTypes.set(key, new Set());
                }
                const valueType = typeof value;
                fieldTypes.get(key)!.add(valueType);
                
                // Collect numeric values for statistics (sample only to save memory)
                if (valueType === "number" && !isNaN(value)) {
                    if (!numericFieldValues.has(key)) {
                        numericFieldValues.set(key, []);
                    }
                    const values = numericFieldValues.get(key)!;
                    // Only keep samples to avoid memory issues
                    if (values.length < 10000) {
                        values.push(value);
                    }
                }
                
                // Collect date values (sample only)
                const keyLower = key.toLowerCase();
                if ((keyLower.includes("date") || keyLower.includes("time") || keyLower.includes("timestamp")) && value) {
                    if (!dateFieldValues.has(key)) {
                        dateFieldValues.set(key, []);
                    }
                    const values = dateFieldValues.get(key)!;
                    if (values.length < 10000) {
                        try {
                            const timestamp = new Date(value).getTime();
                            if (!isNaN(timestamp)) {
                                values.push(timestamp);
                            }
                        } catch {
                            // Ignore invalid dates
                        }
                    }
                }
            }
        }
        
        recordsProcessed += chunk.length;
        
        // Show progress for large datasets
        if (totalRecords > 10000 && recordsProcessed % 10000 === 0) {
            process.stdout.write(chalk.dim(`\r  Processed: ${recordsProcessed.toLocaleString()} / ${totalRecords.toLocaleString()} records...`));
        }
    }
    
    if (totalRecords > 10000) {
        process.stdout.write("\r" + " ".repeat(80) + "\r"); // Clear progress line
    }
    
    const readTime = Date.now() - startTime;

    // Display field statistics
    console.info(`  ${chalk.bold("Total Records:")} ${chalk.white(totalRecords.toLocaleString())}`);
    console.info(`  ${chalk.bold("Unique Fields:")} ${chalk.white(fieldCounts.size)}`);
    console.info(`  ${chalk.bold("Analysis Time:")} ${chalk.white(readTime + "ms")}`);
    console.info("");

    // Show top 10 most common fields
    const sortedFields = Array.from(fieldCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

    console.info(chalk.dim("  Top 10 Fields (by presence):"));
    sortedFields.forEach(([field, count]) => {
        const percentage = ((count / totalRecords) * 100).toFixed(1);
        const types = Array.from(fieldTypes.get(field)!).join(", ");
        console.info(chalk.dim(`    • ${field}: ${count.toLocaleString()} (${percentage}%) - ${types}`));
    });
    console.info("");

    // Numeric field statistics
    if (numericFieldValues.size > 0) {
        console.info(chalk.dim("  Numeric Field Statistics:"));
        
        const numericFieldsToShow = Array.from(numericFieldValues.entries()).slice(0, 5);
        for (const [field, values] of numericFieldsToShow) {
            if (values.length > 0) {
                const min = Math.min(...values);
                const max = Math.max(...values);
                const avg = values.reduce((a, b) => a + b, 0) / values.length;
                
                console.info(chalk.dim(`    • ${field}:`));
                console.info(chalk.dim(`      Min: ${min.toLocaleString()}, Max: ${max.toLocaleString()}, Avg: ${avg.toFixed(2)}`));
                if (values.length < totalRecords) {
                    console.info(chalk.dim(`      (sampled from ${values.length.toLocaleString()} records)`));
                }
            }
        }
        console.info("");
    }

    // Date/timestamp analysis
    if (dateFieldValues.size > 0) {
        console.info(chalk.dim("  Date/Time Fields:"));
        
        const dateFieldsToShow = Array.from(dateFieldValues.entries()).slice(0, 3);
        for (const [field, values] of dateFieldsToShow) {
            if (values.length > 0) {
                const min = new Date(Math.min(...values)).toISOString();
                const max = new Date(Math.max(...values)).toISOString();
                
                console.info(chalk.dim(`    • ${field}:`));
                console.info(chalk.dim(`      Earliest: ${min}`));
                console.info(chalk.dim(`      Latest: ${max}`));
                if (values.length < totalRecords) {
                    console.info(chalk.dim(`      (sampled from ${values.length.toLocaleString()} records)`));
                }
            }
        }
        console.info("");
    }

    // Sample records
    if (sampleRecords.length > 0) {
        console.info(chalk.dim("  Sample Records:"));
        for (let i = 0; i < sampleRecords.length; i++) {
            const record = sampleRecords[i];
            const keys = Object.keys(record).slice(0, 4); // Show first 4 fields
            console.info(chalk.dim(`    Record ${i + 1}:`));
            keys.forEach(key => {
                const value = record[key];
                const displayValue = typeof value === "string" && value.length > 50 
                    ? value.substring(0, 50) + "..." 
                    : value;
                console.info(chalk.dim(`      ${key}: ${displayValue}`));
            });
            if (Object.keys(record).length > 4) {
                console.info(chalk.dim(`      ... (${Object.keys(record).length - 4} more fields)`));
            }
        }
    }
}

/**
 * Analyze JSON object data - show key-value pairs
 */
function analyzeJsonObject(data: Record<string, any>) {
    console.info(chalk.bold.magenta("📦 JSON Object Analysis"));
    console.info(chalk.dim("─".repeat(60)));

    const keys = Object.keys(data);
    console.info(`  ${chalk.bold("Total Keys:")} ${chalk.white(keys.length)}`);
    console.info("");

    // Analyze value types
    const typeDistribution: Record<string, number> = {};
    for (const [key, value] of Object.entries(data)) {
        const type = Array.isArray(value) ? "array" : typeof value;
        typeDistribution[type] = (typeDistribution[type] || 0) + 1;
    }

    console.info(chalk.dim("  Type Distribution:"));
    Object.entries(typeDistribution).forEach(([type, count]) => {
        console.info(chalk.dim(`    • ${type}: ${count} (${((count / keys.length) * 100).toFixed(1)}%)`));
    });
    console.info("");

    // Show sample key-value pairs
    const samplesToShow = Math.min(10, keys.length);
    console.info(chalk.dim(`  Sample Key-Value Pairs (first ${samplesToShow}):`));
    
    for (let i = 0; i < samplesToShow; i++) {
        const key = keys[i];
        const value = data[key];
        let displayValue: string;
        
        if (typeof value === "object" && value !== null) {
            displayValue = Array.isArray(value) 
                ? `[Array: ${value.length} items]`
                : `[Object: ${Object.keys(value).length} keys]`;
        } else if (typeof value === "string" && value.length > 50) {
            displayValue = value.substring(0, 50) + "...";
        } else {
            displayValue = String(value);
        }
        
        console.info(chalk.dim(`    • ${key}: ${displayValue}`));
    }

    if (keys.length > samplesToShow) {
        console.info(chalk.dim(`    ... (${keys.length - samplesToShow} more keys)`));
    }
}

/**
 * Analyze text data - show line count, character count, and preview
 */
function analyzeText(data: string) {
    console.info(chalk.bold.magenta("📝 Text Data Analysis"));
    console.info(chalk.dim("─".repeat(60)));

    const lines = data.split("\n");
    const words = data.split(/\s+/).filter(w => w.length > 0);
    
    console.info(`  ${chalk.bold("Total Characters:")} ${chalk.white(data.length.toLocaleString())}`);
    console.info(`  ${chalk.bold("Total Lines:")} ${chalk.white(lines.length.toLocaleString())}`);
    console.info(`  ${chalk.bold("Total Words:")} ${chalk.white(words.length.toLocaleString())}`);
    console.info(`  ${chalk.bold("Average Line Length:")} ${chalk.white((data.length / lines.length).toFixed(1))} chars`);
    console.info("");

    // Show first few lines
    const linesToShow = Math.min(10, lines.length);
    console.info(chalk.dim(`  First ${linesToShow} Lines:`));
    for (let i = 0; i < linesToShow; i++) {
        const line = lines[i].length > 100 
            ? lines[i].substring(0, 100) + "..." 
            : lines[i];
        console.info(chalk.dim(`    ${i + 1}: ${line}`));
    }
    
    if (lines.length > linesToShow) {
        console.info(chalk.dim(`    ... (${lines.length - linesToShow} more lines)`));
    }
}

/**
 * Analyze XML data - show structure and preview
 */
function analyzeXml(data: string) {
    console.info(chalk.bold.magenta("📄 XML Data Analysis"));
    console.info(chalk.dim("─".repeat(60)));

    const lines = data.split("\n");
    
    console.info(`  ${chalk.bold("Total Characters:")} ${chalk.white(data.length.toLocaleString())}`);
    console.info(`  ${chalk.bold("Total Lines:")} ${chalk.white(lines.length.toLocaleString())}`);
    console.info("");

    // Try to extract root element
    const rootMatch = data.match(/<(\w+)[^>]*>/);
    if (rootMatch) {
        console.info(`  ${chalk.bold("Root Element:")} ${chalk.white("<" + rootMatch[1] + ">")}`);
        console.info("");
    }

    // Count tag types (simple regex approach)
    const tags = data.match(/<(\w+)[^>]*>/g) || [];
    const tagCounts = new Map<string, number>();
    
    tags.forEach(tag => {
        const match = tag.match(/<(\w+)/);
        if (match) {
            const tagName = match[1];
            tagCounts.set(tagName, (tagCounts.get(tagName) || 0) + 1);
        }
    });

    if (tagCounts.size > 0) {
        console.info(chalk.dim("  Tag Frequency:"));
        const sortedTags = Array.from(tagCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);
        
        sortedTags.forEach(([tag, count]) => {
            console.info(chalk.dim(`    • <${tag}>: ${count.toLocaleString()} occurrences`));
        });
        console.info("");
    }

    // Show first few lines
    const linesToShow = Math.min(15, lines.length);
    console.info(chalk.dim(`  First ${linesToShow} Lines:`));
    for (let i = 0; i < linesToShow; i++) {
        const line = lines[i].length > 100 
            ? lines[i].substring(0, 100) + "..." 
            : lines[i];
        console.info(chalk.dim(`    ${line}`));
    }
    
    if (lines.length > linesToShow) {
        console.info(chalk.dim(`    ... (${lines.length - linesToShow} more lines)`));
    }
}

main().catch((error) => {
    console.error(chalk.red("❌ Error:"), error.message);
    if (error.stack) {
        console.error(chalk.dim(error.stack));
    }
    process.exit(1);
});

