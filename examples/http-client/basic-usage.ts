#!/usr/bin/env node

import { HttpClient } from "../../src/http-client.js";
import chalk from "chalk";
import { fileURLToPath } from "url";

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);

// Run with: npx tsx examples/http-client/basic-usage.ts
//
// HttpClient Basic Usage - demonstrates resilient HTTP client with retry logic
//
// This example shows:
// - Creating an HttpClient instance with custom configuration
// - Making GET/POST requests with automatic retry and error handling
// - Handling different response statuses and error types
// - Custom headers, timeouts, and request options
// - Comprehensive logging and debugging

async function main() {
    console.info(chalk.yellow("🌐 HttpClient Basic Usage Example"));
    console.info(chalk.yellow("=".repeat(50)));
    console.info("");

    // Create HttpClient instance with custom config
    const client = new HttpClient({
        timeout: 10000,        // 10 second timeout
        retryCount: 3,         // Retry up to 3 times
        retryDelay: 1000,      // Start with 1 second delay
        maxRetryDelay: 10000,  // Cap delay at 10 seconds
        retryJitter: 0.2,      // 20% jitter to prevent thundering herd
        userAgent: 'HttpClient-Example/1.0',
        logger: {
            debug: (msg) => console.info(chalk.dim(`[DEBUG] ${msg}`)),
            warn: (msg) => console.warn(chalk.yellow(`[WARN] ${msg}`)),
            error: (msg) => console.error(chalk.red(`[ERROR] ${msg}`))
        }
    });

    console.info(chalk.cyan("Configuration:"));
    console.info(`  Timeout: ${chalk.white("10 seconds")}`);
    console.info(`  Retry Count: ${chalk.white("3 attempts")}`);
    console.info(`  Base Retry Delay: ${chalk.white("1 second")}`);
    console.info(`  User Agent: ${chalk.white("HttpClient-Example/1.0")}`);
    console.info("");

    // Example 1: Successful GET request (using HTTPBin for testing)
    console.info(chalk.bold.green("✓ Example 1: Successful GET Request"));
    console.info(chalk.dim("─".repeat(50)));

    try {
        const response = await client.get('https://httpbin.org/get', {
            params: { test: 'example', timestamp: Date.now() },
            headers: { 'X-Custom-Header': 'HttpClient-Test' },
            debug: true
        });

        console.info(`  ${chalk.bold("Status:")} ${chalk.white(response.status)}`);
        console.info(`  ${chalk.bold("HTTP Code:")} ${chalk.white(response.code)}`);
        console.info(`  ${chalk.bold("Duration:")} ${chalk.white(`${response.duration}ms`)}`);
        console.info(`  ${chalk.bold("Retry Count:")} ${chalk.white(response.retryCount)}`);
        console.info(`  ${chalk.bold("URL:")} ${chalk.white(response.finalUrl)}`);
        console.info(`  ${chalk.bold("Custom Header Sent:")} ${chalk.white(response.data.headers['X-Custom-Header'])}`);
        console.info(`  ${chalk.bold("Test Param:")} ${chalk.white(response.data.args.test)}`);
    } catch (error) {
        console.error(chalk.red("Unexpected error:"), error);
    }
    console.info("");

    // Example 2: POST request with JSON data
    console.info(chalk.bold.blue("✓ Example 2: POST Request with JSON Data"));
    console.info(chalk.dim("─".repeat(50)));

    try {
        const postData = {
            name: "HttpClient Example",
            version: "1.0",
            timestamp: new Date().toISOString(),
            features: ["retry", "logging", "error-classification"]
        };

        const response = await client.post('https://httpbin.org/post', {
            data: postData,
            headers: {
                'Content-Type': 'application/json',
                'X-Request-Type': 'example'
            }
        });

        console.info(`  ${chalk.bold("Status:")} ${chalk.white(response.status)}`);
        console.info(`  ${chalk.bold("HTTP Code:")} ${chalk.white(response.code)}`);
        console.info(`  ${chalk.bold("Content-Type:")} ${chalk.white(response.data.headers['Content-Type'])}`);
        console.info(`  ${chalk.bold("Sent Name:")} ${chalk.white(response.data.json.name)}`);
        console.info(`  ${chalk.bold("Features:")} ${chalk.white(response.data.json.features.join(", "))}`);
    } catch (error) {
        console.error(chalk.red("Unexpected error:"), error);
    }
    console.info("");

    // Example 3: Handling different error types
    console.info(chalk.bold.magenta("✓ Example 3: Error Handling Examples"));
    console.info(chalk.dim("─".repeat(50)));

    const errorExamples = [
        { url: 'https://httpbin.org/status/404', expectedError: 'notFound', description: '404 Not Found' },
        { url: 'https://httpbin.org/status/500', expectedError: 'internalServerError', description: '500 Server Error' },
        { url: 'https://non-existent-domain-12345.com', expectedError: 'connectionFailed', description: 'Connection Failed' }
    ];

    for (const example of errorExamples) {
        console.info(`  ${chalk.bold("Testing:")} ${chalk.white(example.description)}`);

        try {
            const response = await client.get(example.url, { timeout: 5000 });

            if (response.error) {
                console.info(`    ${chalk.bold("Error Type:")} ${chalk.red(response.error)}`);
                console.info(`    ${chalk.bold("HTTP Code:")} ${chalk.white(response.code || 'N/A')}`);
                console.info(`    ${chalk.bold("Retries:")} ${chalk.white(response.retryCount)}`);
            } else {
                console.info(`    ${chalk.bold("Unexpected Success:")} ${chalk.white(response.status)}`);
            }
        } catch (error) {
            console.error(`    ${chalk.red("Unexpected Exception:")} ${error}`);
        }
        console.info("");
    }

    // Example 4: Custom timeout and retry override
    console.info(chalk.bold.cyan("✓ Example 4: Per-Request Configuration"));
    console.info(chalk.dim("─".repeat(50)));

    try {
        const response = await client.get('https://httpbin.org/delay/1', {
            timeout: 3000,      // Shorter timeout for this request
            retryCount: 1,      // Only 1 retry for this request
            debug: true
        });

        console.info(`  ${chalk.bold("Status:")} ${chalk.white(response.status)}`);
        console.info(`  ${chalk.bold("Duration:")} ${chalk.white(`${response.duration}ms`)}`);
        console.info(`  ${chalk.bold("Retries:")} ${chalk.white(response.retryCount)}`);
    } catch (error) {
        console.error(chalk.red("Unexpected error:"), error);
    }
    console.info("");

    // Example 5: All HTTP methods
    console.info(chalk.bold.yellow("✓ Example 5: All HTTP Methods"));
    console.info(chalk.dim("─".repeat(50)));

    const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'] as const;

    for (const method of methods) {
        try {
            const url = method === 'GET' ? 'https://httpbin.org/get' :
                       method === 'HEAD' ? 'https://httpbin.org/get' :
                       'https://httpbin.org/post'; // Use POST endpoint for others

            const options: any = {
                timeout: 3000,
                headers: { 'X-Method-Test': method }
            };

            // Add data for methods that support it
            if (['POST', 'PUT', 'PATCH'].includes(method)) {
                options.data = { method, test: true };
            }

            const response = await client.request(method, url, options);

            console.info(`  ${chalk.bold(method.padEnd(7))}: ${chalk.white(response.status)} (${response.duration}ms)`);

        } catch (error) {
            console.error(`  ${chalk.bold(method.padEnd(7))}: ${chalk.red('Failed')}`);
        }
    }
    console.info("");

    console.info(chalk.green("🎉 HttpClient demonstration completed!"));
    console.info("");
    console.info(chalk.dim("💡 Key Features Demonstrated:"));
    console.info(chalk.dim("  • Automatic retry with exponential backoff and jitter"));
    console.info(chalk.dim("  • Human-readable error classification"));
    console.info(chalk.dim("  • Unified response format (never throws)"));
    console.info(chalk.dim("  • Per-request configuration overrides"));
    console.info(chalk.dim("  • Comprehensive logging and debugging"));
    console.info(chalk.dim("  • Support for all HTTP methods"));
    console.info(chalk.dim("  • Custom headers, timeouts, and query parameters"));
    console.info("");
}

main().catch((error) => {
    console.error(chalk.red("❌ Error:"), error.message);
    process.exit(1);
});
