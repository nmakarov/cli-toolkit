#!/usr/bin/env node

import { Args } from "../../src/args.js";
import { Params } from "../../src/params.js";
import { ParamError } from "../../src/errors.js";
import chalk from "chalk";

// Run with: npx tsx examples/params/show-params.ts
//
// Show Params example (no defaults) - demonstrates parameter validation with all required fields
// 
// Command lines to run this example:
// npx tsx examples/params/show-params.ts --name="My App" --port=8080 --debug=true --timeout=5000 --tags="api,web" --numbers="10,20" --flags="true,false" --startDate="-1h" --features="auth,logging" --choice="option1" --logLevel="info" --dbHost="localhost" --dbPort=5432 --dbName="mydb" --apiTimeout=30000 --apiRetries=3 --apiEnabled=true --maxConnections=100 --retryDelay=1000 --enableCache=false
// npx tsx examples/params/show-params.ts --name="Production API" --port=9000 --debug=false --timeout=10000 --tags="prod,api,critical" --numbers="100,200,300" --flags="true,true,false" --startDate="-7d" --features="auth,logging,monitoring,cache" --choice="option2" --logLevel="warn" --dbHost="db.example.com" --dbPort=3306 --dbName="prod_db" --apiTimeout=60000 --apiRetries=5 --apiEnabled=true --maxConnections=500 --retryDelay=2000 --enableCache=true
// npx tsx examples/params/show-params.ts --name="Dev Server" --port=3000 --debug=true --timeout=30000 --tags="dev,test" --numbers="1,2,3,4,5" --flags="false,false,false" --startDate="now" --features="auth,debug" --choice="option3" --logLevel="debug" --dbHost="127.0.0.1" --dbPort=5432 --dbName="dev_db" --apiTimeout=5000 --apiRetries=1 --apiEnabled=false --maxConnections=10 --retryDelay=500 --enableCache=false
// npx tsx examples/params/show-params.ts --name="Test Run" --port=8888 --debug=true --timeout=2000 --tags="test" --numbers="42" --flags="true" --startDate="-30m" --features="logging" --choice="option1" --logLevel="error" --dbHost="testdb" --dbPort=5433 --dbName="test" --apiTimeout=10000 --apiRetries=2 --apiEnabled=true --maxConnections=50 --retryDelay=1500 --enableCache=true

// npx tsx examples/params/show-params.ts --name="Dev Server" --port=3000 --debug=true --timeout=30000

// Define parameter definitions without defaults
const paramDefinitions = {
    // Basic types
    name: "string",
    port: "number",
    debug: "boolean",
    timeout: "number",
    
    // Arrays
    tags: "array(string)",
    numbers: "array(number)",
    flags: "array(boolean)",
    
    // Custom types
    startDate: "date",
    features: "array(string)",
    
    // Validation with values
    choice: { type: "string", values: ["option1", "option2", "option3"] },
    logLevel: { type: "string", values: ["debug", "info", "warn", "error"] },
    
    // Database config
    dbHost: "string",
    dbPort: "number",
    dbName: "string",
    
    // API config
    apiTimeout: "number",
    apiRetries: "number",
    apiEnabled: "boolean",
    
    // Advanced config
    maxConnections: "number",
    retryDelay: "number",
    enableCache: "boolean"
};

// Create Args instance with aliases
const args = new Args({
    aliases: {
        "n": "name",
        "p": "port", 
        "d": "debug",
        "t": "timeout",
        "l": "logLevel",
        "h": "dbHost",
        "r": "apiRetries"
    }
});

// Initialize Params instance
const params = new Params({ args });

console.info(chalk.yellow("🔧 Params Library Demonstration (No Defaults)"));
console.info(chalk.yellow("==============================================\n"));

// Show valid parameters
const validParameters = Object.keys(paramDefinitions).map(key => `--${key} (-${key[0]})`);
console.info(chalk.yellow("Valid parameters:") + " " + validParameters.join(", "));
console.info(chalk.dim("Note: Parameters have no defaults, validation only.\n"));

try {
    // Assign all definitions
    for (const [key, definition] of Object.entries(paramDefinitions)) {
        params.assignDefinition(key, definition);
    }

    // Get and validate all parameters
    const allParams = params.getAll(paramDefinitions);

    console.info(chalk.bold.green("✓ All Parameters Validated Successfully"));
    console.info(chalk.bold("========================================\n"));

    // Helper to format value display
    const formatValue = (value: any): string => {
        if (value === undefined || value === null) {
            return chalk.dim("(not provided)");
        }
        if (Array.isArray(value)) {
            return `[${value.join(", ")}]`;
        }
        return String(value);
    };

    // Display parameters by category
    console.info(chalk.bold.cyan("Basic Configuration:"));
    console.info(chalk.dim("─".repeat(40)));
    console.info(`  ${chalk.bold("name")}:    ${formatValue(allParams.name)}`);
    console.info(`  ${chalk.bold("port")}:    ${formatValue(allParams.port)}${allParams.port ? "ms" : ""}`);
    console.info(`  ${chalk.bold("debug")}:   ${formatValue(allParams.debug)}`);
    console.info(`  ${chalk.bold("timeout")}: ${formatValue(allParams.timeout)}${allParams.timeout ? "ms" : ""}`);
    console.info("");

    console.info(chalk.bold.cyan("Arrays:"));
    console.info(chalk.dim("─".repeat(40)));
    console.info(`  ${chalk.bold("tags")}:    ${formatValue(allParams.tags)}`);
    console.info(`  ${chalk.bold("numbers")}: ${formatValue(allParams.numbers)}`);
    console.info(`  ${chalk.bold("flags")}:   ${formatValue(allParams.flags)}`);
    console.info("");

    console.info(chalk.bold.cyan("Custom Types:"));
    console.info(chalk.dim("─".repeat(40)));
    console.info(`  ${chalk.bold("startDate")}: ${formatValue(allParams.startDate)}`);
    console.info(`  ${chalk.bold("features")}:  ${formatValue(allParams.features)}`);
    console.info("");

    console.info(chalk.bold.cyan("Validated Choices:"));
    console.info(chalk.dim("─".repeat(40)));
    console.info(`  ${chalk.bold("choice")}:   ${formatValue(allParams.choice)}`);
    console.info(`  ${chalk.bold("logLevel")}: ${formatValue(allParams.logLevel)}`);
    console.info("");

    console.info(chalk.bold.cyan("Database Configuration:"));
    console.info(chalk.dim("─".repeat(40)));
    console.info(`  ${chalk.bold("dbHost")}: ${formatValue(allParams.dbHost)}`);
    console.info(`  ${chalk.bold("dbPort")}: ${formatValue(allParams.dbPort)}`);
    console.info(`  ${chalk.bold("dbName")}: ${formatValue(allParams.dbName)}`);
    console.info("");

    console.info(chalk.bold.cyan("API Configuration:"));
    console.info(chalk.dim("─".repeat(40)));
    console.info(`  ${chalk.bold("apiTimeout")}: ${formatValue(allParams.apiTimeout)}${allParams.apiTimeout ? "ms" : ""}`);
    console.info(`  ${chalk.bold("apiRetries")}: ${formatValue(allParams.apiRetries)}`);
    console.info(`  ${chalk.bold("apiEnabled")}: ${formatValue(allParams.apiEnabled)}`);
    console.info("");

    console.info(chalk.bold.cyan("Advanced Settings:"));
    console.info(chalk.dim("─".repeat(40)));
    console.info(`  ${chalk.bold("maxConnections")}: ${formatValue(allParams.maxConnections)}`);
    console.info(`  ${chalk.bold("retryDelay")}:     ${formatValue(allParams.retryDelay)}${allParams.retryDelay ? "ms" : ""}`);
    console.info(`  ${chalk.bold("enableCache")}:    ${formatValue(allParams.enableCache)}`);
    console.info("");

    // Show type information for provided parameters
    console.info(chalk.bold.magenta("Type Information:"));
    console.info(chalk.dim("─".repeat(40)));
    if (allParams.name !== undefined) {
        console.info(`  name:           ${chalk.dim(typeof allParams.name)}`);
    }
    if (allParams.port !== undefined) {
        console.info(`  port:           ${chalk.dim(typeof allParams.port)}`);
    }
    if (allParams.tags !== undefined) {
        console.info(`  tags:           ${chalk.dim(Array.isArray(allParams.tags) ? "array" : typeof allParams.tags)}`);
    }
    if (allParams.numbers !== undefined) {
        console.info(`  numbers:        ${chalk.dim(Array.isArray(allParams.numbers) ? "array" : typeof allParams.numbers)}`);
    }
    if (allParams.startDate !== undefined) {
        console.info(`  startDate:      ${chalk.dim(allParams.startDate instanceof Date ? "Date" : typeof allParams.startDate)}`);
    }
    console.info("");

} catch (error) {
    if (error instanceof ParamError) {
        console.error(chalk.bold.red("\n✗ Parameter Validation Error"));
        console.error(chalk.red("═".repeat(40)));
        console.error(chalk.red(`  ${error.message}`));
        console.error("");
        console.error(chalk.yellow("Available parameters:"));
        Object.keys(paramDefinitions).forEach(key => {
            console.error(chalk.dim(`  --${key}`));
        });
        console.error("");
        console.error(chalk.dim("Example usage:"));
        console.error(chalk.dim(`  npx tsx examples/params/show-params.ts \\`));
        console.error(chalk.dim(`    --name="My App" --port=8080 --debug=true --timeout=5000 \\`));
        console.error(chalk.dim(`    --tags="api,web" --numbers="10,20" --flags="true,false" \\`));
        console.error(chalk.dim(`    --startDate="-1h" --features="auth,logging" \\`));
        console.error(chalk.dim(`    --choice="option1" --logLevel="info" \\`));
        console.error(chalk.dim(`    --dbHost="localhost" --dbPort=5432 --dbName="mydb" \\`));
        console.error(chalk.dim(`    --apiTimeout=30000 --apiRetries=3 --apiEnabled=true \\`));
        console.error(chalk.dim(`    --maxConnections=100 --retryDelay=1000 --enableCache=false`));
        console.error("");
        process.exit(1);
    } else {
        console.error(chalk.bold.red("\n✗ Unexpected Error"));
        console.error(chalk.red("═".repeat(40)));
        console.error(chalk.red(`  ${error instanceof Error ? error.message : String(error)}`));
        console.error("");
        process.exit(1);
    }
}
