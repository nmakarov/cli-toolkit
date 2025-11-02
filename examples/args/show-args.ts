#!/usr/bin/env node

// Show Args example - uses real CLI arguments
// 
// Command lines to run this example:
// npx tsx examples/args/show-args.ts --verbose --output=file.txt
// npx tsx examples/args/show-args.ts -v -o=file.txt
// npx tsx examples/args/show-args.ts build --verbose --output=dist/
// npx tsx examples/args/show-args.ts --message="Hello World" --key="5=five"
// npx tsx examples/args/show-args.ts --help
// npx tsx examples/args/show-args.ts --config=examples/args/config.json --verbose
// npx tsx examples/args/show-args.ts --config=examples/args/config.json,examples/args/config.local.json --env=production
// npx tsx examples/args/show-args.ts --dotEnvFile=examples/args/env.example
// npx tsx examples/args/show-args.ts --dotEnvPath=examples/args --dotEnvFile=env.example
// npx tsx examples/args/show-args.ts --env=local --dotEnvPath=examples/args
// npx tsx examples/args/show-args.ts --env=production --dotEnvPath=examples/args
// npx tsx examples/args/show-args.ts --env=test --dotEnvPath=examples/args

import { Args } from "../../src/args.js";
import chalk from "chalk";

// Define valid parameters and commands
const allKeys = ["debug", "verbose", "silent", "help", "output", "format", "timeout", "message", "key", "camelCase" ];
const validCommands = ["build", "test", "deploy", "serve", "watch"];

// Construct aliases from first letters
const aliases = allKeys.reduce((acc, key) => {
    acc[key[0]] = key;
    return acc;
}, {} as Record<string, string>);

// Create Args instance with real CLI arguments (no constructor args specified)
const args = new Args({
    aliases: aliases
});

// Construct validParameters display strings
const validParameters = allKeys.map(key => `--${key} (-${key[0]})`);

// Show valid parameters and commands
console.info(chalk.yellow("Valid parameters:" ) + " " + validParameters.join(", "));
console.info(chalk.yellow("Valid commands:" ) + " " + validCommands.join(", "));
console.info("");

// Show discovered values in a clean format
console.info(chalk.bold("Discovered values:"));
console.info("==================");

// Find the longest key name for alignment
const maxKeyLength = Math.max(...allKeys.map(key => key.length));

for (const key of allKeys) {
    const value = args.get(key);
    const displayValue = value !== undefined ? 
        (typeof value === "string" ? `"${value}"` : value) : 
        "";
    
    const status = value !== undefined ? chalk.green("✓") : chalk.gray("✗");
    const paddedKey = key.padEnd(maxKeyLength);
    console.info(`  ${status} ${chalk.bold(paddedKey)} ${displayValue}`);
}

// Show commands
const commands = args.getCommands();
console.info("\n" + chalk.bold("Commands:"));
console.info("==========");
if (commands.length > 0) {
    commands.forEach(cmd => {
        console.info(`  ${chalk.green("✓")} ${chalk.bold(cmd)}`);
    });
} else {
    console.info(`  ${chalk.gray("(none)")}`);
}

// Show unused keys
const unusedKeys = args.getUnused();
console.info("\n" + chalk.bold("Unused keys:"));
console.info("============");
if (unusedKeys.length > 0) {
    unusedKeys.forEach(key => {
        console.info(`  ${chalk.red("✗")} ${chalk.bold(key)}`);
    });
} else {
    console.info(`  ${chalk.gray("(none)")}`);
}


