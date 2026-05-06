#!/usr/bin/env node

import { Args } from "../../src/args/index.js";
import { Params } from "../../src/params/index.js";
import { ParamError } from "../../src/errors.js";
import chalk from "chalk";

// Run with: npx tsx examples/params/show-params-defaults.ts

// Show Params example with defaults - demonstrates parameter validation and type checking
// 
// Command lines to run this example:
// npx tsx examples/params/show-params-defaults.ts --name="My App" --port=8080 --debug=true
// npx tsx examples/params/show-params-defaults.ts --tags="api,web,db" --startDate="-1h" --timeout=5000
// npx tsx examples/params/show-params-defaults.ts --choice="option2" --numbers="10,20,30" --flags="true,false,true"
// npx tsx examples/params/show-params-defaults.ts --dbHost="localhost" --dbPort=5432 --logLevel="info"
// npx tsx examples/params/show-params-defaults.ts --features="auth,logging,cache" --maxConnections=200
// npx tsx examples/params/show-params-defaults.ts --name="Test" --port=invalid --debug=maybe
// npx tsx examples/params/show-params-defaults.ts --requiredParam="value" --optionalParam="test"

// Define parameter definitions for various use cases
const paramDefinitions = {
    // Basic types
    name: "string required",
    port: "number default 3000",
    debug: "boolean default false",
    timeout: "number default 5000",
    
    // Arrays
    tags: "array(string) default frontend,backend",
    numbers: "array(number) default 1,2,3",
    flags: "array(boolean) default true,false",
    
    // Custom types
    startDate: "date default -7d",
    features: "array(string) default auth,logging",
    
    // Validation with values
    choice: { type: "string", values: ["option1", "option2", "option3"] },
    logLevel: { type: "string", values: ["debug", "info", "warn", "error"] },
    
    // Database config
    dbHost: "string default localhost",
    dbPort: "number default 5432",
    dbName: "string required",
    
    // API config
    apiTimeout: "number default 30000",
    apiRetries: "number default 3",
    apiEnabled: "boolean default true",
    
    // Advanced config
    maxConnections: "number default 100",
    retryDelay: "number default 1000",
    enableCache: "boolean default false"
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

console.info(chalk.yellow("🔧 Params Library Demonstration"));
console.info(chalk.yellow("================================\n"));

// Show valid parameters
const validParameters = Object.keys(paramDefinitions).map(key => `--${key} (-${key[0]})`);
console.info(chalk.yellow("Valid parameters:") + " " + validParameters.join(", "));
console.info("");

try {
    // Show discovered values in a clean format
    console.info(chalk.bold("Parameter Values:"));
    console.info("==================");

    // Find the longest key name for alignment
    const maxKeyLength = Math.max(...Object.keys(paramDefinitions).map(key => key.length));

    // Process each parameter definition
    for (const [key, definition] of Object.entries(paramDefinitions)) {
        try {
            const value = params.get(key, definition);
            const displayValue = formatValue(value);
            const status = chalk.green("✓");
            const paddedKey = key.padEnd(maxKeyLength);
            console.info(`  ${status} ${chalk.bold(paddedKey)} ${displayValue}`);
        } catch (error) {
            if (error instanceof ParamError) {
                const status = chalk.red("✗");
                const paddedKey = key.padEnd(maxKeyLength);
                console.info(`  ${status} ${chalk.bold(paddedKey)} ${chalk.red(`ERROR: ${error.message}`)}`);
            } else {
                throw error;
            }
        }
    }

    console.info("\n" + chalk.bold("Validation Results:"));
    console.info("==================");

    // Show validation summary
    let validCount = 0;
    let errorCount = 0;
    const errors = [];

    for (const [key, definition] of Object.entries(paramDefinitions)) {
        try {
            params.get(key, definition);
            validCount++;
        } catch (error) {
            if (error instanceof ParamError) {
                errorCount++;
                errors.push(`${key}: ${error.message}`);
            }
        }
    }

    console.info(`  ${chalk.green("✓")} Valid parameters: ${validCount}`);
    console.info(`  ${chalk.red("✗")} Invalid parameters: ${errorCount}`);

    if (errors.length > 0) {
        console.info("\n" + chalk.bold("Validation Errors:"));
        console.info("==================");
        errors.forEach(error => {
            console.info(`  ${chalk.red("✗")} ${error}`);
        });
    }

    // Show getter/setter hooks example
    console.info("\n" + chalk.bold("Getter/Setter Hooks:"));
    console.info("====================");

    // Register a getter for dynamic values
    params.registerParamGetter((key) => {
        if (key === "dynamicValue") {
            return `generated-${Date.now()}`;
        }
        return undefined;
    });

    // Register a setter for special handling
    params.registerParamSetter((key, value) => {
        if (key === "specialKey") {
            console.info(`  → Special setter handled: ${key} = ${value}`);
            return true;
        }
        return false;
    });

    const dynamic = params.get("dynamicValue", "string");
    console.info(`  ${chalk.green("✓")} dynamicValue: "${dynamic}"`);

    params.set("specialKey", "specialValue", "string");
    console.info(`  ${chalk.green("✓")} specialKey setter called`);

    // Params has no module-level singleton (unlike Args.init / getArgsInstance on ./args).
    // Framework code uses Params.init(context, options) for staged setup; otherwise use `new Params({ args })`.
    console.info("\n" + chalk.bold("Params.init + multiple instances:"));
    console.info("=====================================");

    const viaInit = Params.init({ args } , { singletonValue: "from-init" });
    const singletonValue = viaInit.get("singletonValue", "string");
    console.info(`  ${chalk.green("✓")} Params.init options: singletonValue = ${JSON.stringify(singletonValue)}`);

    const second = new Params({ args });
    console.info(`  ${chalk.green("✓")} new Params({ same args }) !== first instance: ${second !== params}`);

    // Show real-world config example
    console.info("\n" + chalk.bold("Real-World Config:"));
    console.info("==================");

    const appConfig = {
        dbHost: "string default localhost",
        dbPort: "number default 5432", 
        apiTimeout: "number default 30000",
        logLevel: { type: "string", values: ["debug", "info", "warn", "error"] },
        features: "array(string) default auth,logging"
    };

    try {
        const validatedConfig = params.getAll(appConfig);
        console.info("  Application configuration validated:");
        console.info("  " + JSON.stringify(validatedConfig, null, 2).split("\n").join("\n  "));
    } catch (error) {
        if (error instanceof ParamError) {
            console.info(`  ${chalk.red("✗")} Config validation failed: ${error.message}`);
        }
    }

    console.info("\n" + chalk.green("🎉 Params demonstration completed!"));
    console.info("\n" + chalk.yellow("Try running with different arguments:"));
    console.info("  npx tsx examples/params/show-params.ts --name=\"My App\" --port=8080 --debug=true");
    console.info("  npx tsx examples/params/show-params.ts --tags=\"api,web,db\" --startDate=\"-1h\"");
    console.info("  npx tsx examples/params/show-params.ts --choice=\"option2\" --numbers=\"10,20,30\"");
    console.info("  npx tsx examples/params/show-params.ts --logLevel=\"info\" --maxConnections=200");

} catch (error) {
    if (error instanceof ParamError) {
        console.error(chalk.red("❌ Parameter Error:"), error.message);
        console.error("\nThis usually means:");
        console.error("- A required parameter is missing");
        console.error("- A parameter has an invalid value");
        console.error("- A parameter doesn't match the expected type");
        process.exit(1);
    } else {
        console.error(chalk.red("❌ Unexpected Error:"), error);
        process.exit(1);
    }
}

// Helper function to format values for display
function formatValue(value) {
    if (value === undefined) {
        return chalk.gray("(undefined)");
    }
    
    if (Array.isArray(value)) {
        return `[${value.map(v => typeof v === "string" ? `"${v}"` : v).join(", ")}]`;
    }
    
    if (typeof value === "string") {
        return `"${value}"`;
    }
    
    if (value instanceof Date) {
        return `"${value.toISOString()}"`;
    }
    
    return String(value);
}


