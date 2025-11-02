#!/usr/bin/env node

import { Args } from "../../src/args.js";
import { Params } from "../../src/params.js";
import { ParamError } from "../../src/errors.js";
import chalk from "chalk";

// Run with: npx tsx examples/params/time-params-playground.ts
//
// Time Params Playground - demonstrates timezone handling and date formatting
// 
// Command lines to run this example:
// npx tsx examples/params/time-params-playground.ts --startDate="2025-09-26T01:02:03Z"
// npx tsx examples/params/time-params-playground.ts --startDate="-7d"
// npx tsx examples/params/time-params-playground.ts --startDate="now"
// npx tsx examples/params/time-params-playground.ts --startDate="-1h" --endDate="@startDate+2h"
// npx tsx examples/params/time-params-playground.ts --startDate="2025-09-26T01:02:03Z" --endDate="@startDate+30d"
// npx tsx examples/params/time-params-playground.ts --eventTime="2025-12-01T00:00:00Z" --scheduledFor="@eventTime-1h"

// TODO: accept the short zone specs as well, like -08, -8
// npx tsx examples/params/time-params-playground.ts --startDate="2025-05-05T12:00:00Z" --endDate=2025-05-05T12:00:00-08:00
// npx tsx examples/params/time-params-playground.ts --startDate="2025-05-05T12:00:00Z" --endDate=2025-05-05T12:00:00-08
// npx tsx examples/params/time-params-playground.ts --startDate="2025-05-05T12:00:00Z" --endDate=2025-05-05T12:00:00-8


// Helper: Format ISO string for display with optional timezone conversion
const formatISOForDisplay = (
    isoString: string | undefined, 
    format: "iso" | "date" | "time" | "human" = "iso",
    timezoneOffset?: number
): string => {
    if (!isoString || typeof isoString !== "string") {
        return chalk.dim("(not provided)");
    }

    const date = new Date(isoString);
    if (isNaN(date.getTime())) {
        return chalk.red("(invalid)");
    }

    // Apply timezone offset if provided
    let workingDate = date;
    let offsetSuffix = "Z";
    
    if (timezoneOffset !== undefined) {
        const offsetMs = timezoneOffset * 60 * 60 * 1000;
        workingDate = new Date(date.getTime() + offsetMs);
        
        const offsetSign = timezoneOffset >= 0 ? "+" : "-";
        const absOffsetHours = String(Math.abs(Math.floor(timezoneOffset))).padStart(2, "0");
        const offsetMinutes = String(Math.abs((timezoneOffset % 1) * 60)).padStart(2, "0");
        offsetSuffix = `${offsetSign}${absOffsetHours}:${offsetMinutes}`;
    }

    switch (format) {
        case "iso":
            // Full ISO8601: 2025-01-01T01:01:01Z or 2025-01-01T01:01:01-08:00
            if (timezoneOffset !== undefined) {
                const year = workingDate.getUTCFullYear();
                const month = String(workingDate.getUTCMonth() + 1).padStart(2, "0");
                const day = String(workingDate.getUTCDate()).padStart(2, "0");
                const hours = String(workingDate.getUTCHours()).padStart(2, "0");
                const minutes = String(workingDate.getUTCMinutes()).padStart(2, "0");
                const seconds = String(workingDate.getUTCSeconds()).padStart(2, "0");
                return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${offsetSuffix}`;
            }
            return isoString;
        
        case "date":
            // Date only: 2025-01-01
            if (timezoneOffset !== undefined) {
                const year = workingDate.getUTCFullYear();
                const month = String(workingDate.getUTCMonth() + 1).padStart(2, "0");
                const day = String(workingDate.getUTCDate()).padStart(2, "0");
                return `${year}-${month}-${day}`;
            }
            return isoString.split("T")[0];
        
        case "time":
            // Time only: 01:01:01Z or 01:01:01-08:00
            if (timezoneOffset !== undefined) {
                const hours = String(workingDate.getUTCHours()).padStart(2, "0");
                const minutes = String(workingDate.getUTCMinutes()).padStart(2, "0");
                const seconds = String(workingDate.getUTCSeconds()).padStart(2, "0");
                return `${hours}:${minutes}:${seconds}${offsetSuffix}`;
            }
            return isoString.split("T")[1];
        
        case "human":
            // Human-readable: Mon, 01 Jan 2025 01:01:01 GMT
            return timezoneOffset !== undefined ? workingDate.toUTCString() : date.toUTCString();
        
        default:
            return isoString;
    }
};

// Define parameter definitions
// Note: Order matters for cross-parameter references (@paramName+offset)
const paramDefinitions = {
    startDate: "edate",
    endDate: "edate",
    eventTime: "edate",
    scheduledFor: "edate"
};

// Create Args instance with aliases
// TODO: auto-aliases, if not provided
const args = new Args({
    aliases: {
        "s": "startDate",
        "e": "endDate",
        "z": "timezone",
        "t": "eventTime"
    }
});

// Initialize Params instance
const params = new Params({ args });

console.info(chalk.yellow("🕐 Time Params Playground"));
console.info(chalk.yellow("=========================\n"));

// Show valid parameters
const validParameters = Object.keys(paramDefinitions).map(key => `--${key} (-${key[0]})`);
console.info(chalk.yellow("Valid parameters:") + " " + validParameters.join(", "));
console.info(chalk.dim("Demonstrates timezone handling and ISO8601 string formatting.\n"));

try {
    // Assign all definitions
    for (const [key, definition] of Object.entries(paramDefinitions)) {
        params.assignDefinition(key, definition);
    }

    // Get and validate all parameters
    const allParams = params.getAll(paramDefinitions);

    console.info(chalk.bold.green("✓ Parameters Parsed Successfully"));
    console.info(chalk.bold("=================================\n"));

    console.info(chalk.bold.cyan("UTC ISO8601 Timestamps (Internal Format):"));
    console.info(chalk.dim("─".repeat(60)));
    console.info(`  ${chalk.bold("startDate")}:     ${chalk.green(formatISOForDisplay(allParams.startDate, "iso"))}`);
    console.info(`  ${chalk.bold("endDate")}:       ${chalk.green(formatISOForDisplay(allParams.endDate, "iso"))}`);
    console.info(`  ${chalk.bold("eventTime")}:     ${chalk.green(formatISOForDisplay(allParams.eventTime, "iso"))}`);
    console.info(`  ${chalk.bold("scheduledFor")}:  ${chalk.green(formatISOForDisplay(allParams.scheduledFor, "iso"))}`);
    console.info("");

    console.info(chalk.bold.cyan("PST Timezone (UTC-8):"));
    console.info(chalk.dim("─".repeat(60)));
    console.info(`  ${chalk.bold("startDate")}:     ${chalk.green(formatISOForDisplay(allParams.startDate, "iso", -8))}`);
    console.info(`  ${chalk.bold("endDate")}:       ${chalk.green(formatISOForDisplay(allParams.endDate, "iso", -8))}`);
    console.info(`  ${chalk.bold("eventTime")}:     ${chalk.green(formatISOForDisplay(allParams.eventTime, "iso", -8))}`);
    console.info(`  ${chalk.bold("scheduledFor")}:  ${chalk.green(formatISOForDisplay(allParams.scheduledFor, "iso", -8))}`);
    console.info("");

    console.info(chalk.bold.cyan("Date-Only Format (YYYY-MM-DD):"));
    console.info(chalk.dim("─".repeat(60)));
    console.info(`  ${chalk.bold("startDate")}:     ${formatISOForDisplay(allParams.startDate, "date")}`);
    console.info(`  ${chalk.bold("endDate")}:       ${formatISOForDisplay(allParams.endDate, "date")}`);
    console.info(`  ${chalk.bold("eventTime")}:     ${formatISOForDisplay(allParams.eventTime, "date")}`);
    console.info(`  ${chalk.bold("scheduledFor")}:  ${formatISOForDisplay(allParams.scheduledFor, "date")}`);
    console.info("");

    console.info(chalk.bold.cyan("Human-Readable Format:"));
    console.info(chalk.dim("─".repeat(60)));
    console.info(`  ${chalk.bold("startDate")}:     ${formatISOForDisplay(allParams.startDate, "human")}`);
    console.info(`  ${chalk.bold("endDate")}:       ${formatISOForDisplay(allParams.endDate, "human")}`);
    console.info(`  ${chalk.bold("eventTime")}:     ${formatISOForDisplay(allParams.eventTime, "human")}`);
    console.info(`  ${chalk.bold("scheduledFor")}:  ${formatISOForDisplay(allParams.scheduledFor, "human")}`);
    console.info("");

    // Show date calculations if both start and end dates are provided
    if (allParams.startDate && allParams.endDate) {
        const startMs = new Date(allParams.startDate).getTime();
        const endMs = new Date(allParams.endDate).getTime();
        const diffMs = endMs - startMs;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffMinutes = Math.floor(diffMs / (1000 * 60));

        console.info(chalk.bold.magenta("Time Span (startDate → endDate):"));
        console.info(chalk.dim("─".repeat(60)));
        console.info(`  ${chalk.bold("Duration (days)")}:    ${diffDays} days`);
        console.info(`  ${chalk.bold("Duration (hours)")}:   ${diffHours} hours`);
        console.info(`  ${chalk.bold("Duration (minutes)")}: ${diffMinutes} minutes`);
        console.info(`  ${chalk.bold("Duration (ms)")}:      ${diffMs} milliseconds`);
        console.info("");
    }

    // Show usage notes
    console.info(chalk.bold.yellow("Usage Notes:"));
    console.info(chalk.dim("─".repeat(60)));
    console.info(chalk.dim("• Internal representation: UTC ISO8601 strings (YYYY-MM-DDTHH:mm:ssZ)"));
    console.info(chalk.dim("• Cross-parameter references: Use @paramName+offset (e.g., @startDate+2h)"));
    console.info(chalk.dim("• Relative time: -2h, +1d, now (relative to current time)"));
    console.info(chalk.dim("• Direct ISO input: 2025-01-01T01:01:01Z"));
    console.info(chalk.dim("• Parameters are evaluated left-to-right for @references"));
    console.info("");

} catch (error) {
    if (error instanceof ParamError) {
        console.error(chalk.bold.red("\n✗ Parameter Validation Error"));
        console.error(chalk.red("═".repeat(50)));
        console.error(chalk.red(`  ${error.message}`));
        console.error("");
        process.exit(1);
    } else {
        console.error(chalk.bold.red("\n✗ Unexpected Error"));
        console.error(chalk.red("═".repeat(50)));
        console.error(chalk.red(`  ${error instanceof Error ? error.message : String(error)}`));
        console.error("");
        process.exit(1);
    }
}

