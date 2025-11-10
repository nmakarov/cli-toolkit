#!/usr/bin/env node

import { MockServer, createMockServer } from "../../src/mock-server.js";
import { HttpClient } from "../../src/http-client.js";
import chalk from "chalk";
import { fileURLToPath } from "url";
import path from "path";

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Run with: npx tsx examples/mock-server/basic-usage.ts
// Note: This example properly cleans up and exits automatically
//
// MockServer Basic Usage - demonstrates HTTP mock server with FileDatabase integration
//
// This example shows:
// - Starting a mock server on a custom port
// - Capturing and storing mock responses
// - Serving stored mock responses
// - Using HttpClient with test server redirection
// - Managing mock data and cleanup

async function main() {
    console.info(chalk.yellow("🧪 MockServer Basic Usage Example"));
    console.info(chalk.yellow("=".repeat(50)));
    console.info("");

    const mockDataPath = path.resolve(__dirname, "data");

    // Create HttpClient configured to use mock server
    const httpClient = new HttpClient({
        timeout: 5000,
        logger: {
            debug: (msg) => console.info(chalk.dim(`[HTTP] ${msg}`)),
            warn: (msg) => console.warn(chalk.yellow(`[HTTP] ${msg}`)),
            error: (msg) => console.error(chalk.red(`[HTTP] ${msg}`))
        }
    });

    let mockServer: MockServer | undefined;

    try {
        // Example 1: Start MockServer
        console.info(chalk.bold.green("✓ Example 1: Starting MockServer"));
        console.info(chalk.dim("─".repeat(50)));

        mockServer = new MockServer({
            basePath: mockDataPath,
            port: 5030,
            namespace: 'examples',
            tableName: 'responses',
            sensitiveKeys: ['authorization', 'api_key', 'password'], // Custom sensitive keys
            debug: true,
            logger: console
        });

        const serverInstance = await mockServer.start();
        console.info(`  ${chalk.bold("Server started on port:")} ${chalk.white(serverInstance.port)}`);
        console.info(`  ${chalk.bold("Data path:")} ${chalk.white(mockDataPath)}`);
        console.info("");

        // Example 2: Capture mock responses
        console.info(chalk.bold.blue("✓ Example 2: Capturing Mock Responses"));
        console.info(chalk.dim("─".repeat(50)));

        // Simulate capturing responses (normally done by intercepting real requests)
        const mockResponse1 = {
            status: 200,
            headers: { 'content-type': 'application/json', 'x-api-version': '1.0' },
            data: { id: 1, name: 'John Doe', email: 'john@example.com' }
        };

        const mockResponse2 = {
            status: 201,
            headers: { 'content-type': 'application/json', 'location': '/users/2' },
            data: { id: 2, name: 'Jane Smith', email: 'jane@example.com', created: true }
        };

        // Store mock responses
        const filename1 = await mockServer.storeMock(
            'https://api.example.com/users/1',
            null,
            mockResponse1,
            'getUser',
            'Get User Profile'
        );

        const filename2 = await mockServer.storeMock(
            'https://api.example.com/users',
            { name: 'Jane Smith', email: 'jane@example.com' },
            mockResponse2,
            'createUser',
            'Create New User'
        );

        console.info(`  ${chalk.bold("Stored mock 1:")} ${chalk.white(filename1)}`);
        console.info(`  ${chalk.bold("Stored mock 2:")} ${chalk.white(filename2)}`);
        console.info("");

        // Example 3: Query stored mocks
        console.info(chalk.bold.magenta("✓ Example 3: Querying Stored Mocks"));
        console.info(chalk.dim("─".repeat(50)));

        const allMocks = await mockServer.listMocks();
        console.info(`  ${chalk.bold("Total stored mocks:")} ${chalk.white(allMocks.length)}`);

        allMocks.forEach((mock, index) => {
            console.info(`  ${chalk.bold(`Mock ${index + 1}:`)} ${chalk.white(mock.mockName || 'Unnamed')}`);
            console.info(`    ${chalk.dim("Method:")} ${mock.method} ${chalk.dim("Host:")} ${mock.host} ${chalk.dim("Path:")} ${mock.pathname}`);
            console.info(`    ${chalk.dim("Operation ID:")} ${mock.operationId || 'none'}`);
            console.info("");
        });

        // Example 4: Test server redirection (simulated)
        console.info(chalk.bold.cyan("✓ Example 4: Test Server Redirection"));
        console.info(chalk.dim("─".repeat(50)));

        console.info(`  ${chalk.bold("Mock server running at:")} http://localhost:${serverInstance.port}`);
        console.info(`  ${chalk.bold("Test endpoints available:")}`);
        console.info(`    ${chalk.white("GET  /version")} - Server version info`);
        console.info(`    ${chalk.white("GET  /404")} - 404 error response`);
        console.info(`    ${chalk.white("GET  /test")} - Test endpoint with delay/error simulation`);
        console.info(`    ${chalk.white("ANY  /*")} - Mock response matching`);
        console.info("");

        // Example 5: HttpClient with test server
        console.info(chalk.bold.yellow("✓ Example 5: HttpClient with Test Server"));
        console.info(chalk.dim("─".repeat(50)));

        // Note: In a real scenario, you would configure HttpClient to redirect to the test server
        // This demonstrates how it would work:

        console.info(`  ${chalk.bold("Configuration for test server redirection:")}`);
        console.info(`    ${chalk.dim("useTestServer:")} ${chalk.white(`'http://localhost:${serverInstance.port}'`)}`);
        console.info(`    ${chalk.dim("XAXIOSOrigin header:")} ${chalk.white("Set to original URL")}`);
        console.info(`    ${chalk.dim("Result:")} ${chalk.white("Requests redirected to mock server")}`);
        console.info("");

        // Example 6: Server statistics and cleanup
        console.info(chalk.bold.green("✓ Example 6: Server Statistics & Cleanup"));
        console.info(chalk.dim("─".repeat(50)));

        const stats = serverInstance.getStats();
        console.info(`  ${chalk.bold("Server Statistics:")}`);
        console.info(`    ${chalk.dim("Total requests:")} ${chalk.white(stats.totalRequests)}`);
        console.info(`    ${chalk.dim("Mock responses:")} ${chalk.white(stats.mockResponses)}`);
        console.info(`    ${chalk.dim("Fallback responses:")} ${chalk.white(stats.fallbackResponses)}`);
        console.info(`    ${chalk.dim("Errors:")} ${chalk.white(stats.errors)}`);
        console.info(`    ${chalk.dim("Uptime:")} ${chalk.white(`${Math.round(stats.uptime / 1000)}s`)}`);
        console.info("");

        // Run maintenance (cleanup orphaned files)
        console.info(`  ${chalk.bold("Running maintenance...")}`);
        const maintenanceResult = await mockServer.maintenance();
        console.info(`    ${chalk.dim("Files cleaned:")} ${chalk.white(maintenanceResult.cleaned)}`);
        console.info("");

        // Example 7: Sensitive data masking demonstration
        console.info(chalk.bold.red("✓ Example 7: Sensitive Data Masking"));
        console.info(chalk.dim("─".repeat(50)));

        const sensitiveResponse = {
            status: 200,
            headers: {
                'content-type': 'application/json',
                'authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
            },
            data: {
                user: 'john_doe',
                api_key: 'sk-1234567890abcdef',
                password: 'secret123',
                email: 'john@example.com'
            }
        };

        const maskedFilename = await mockServer.storeMock(
            'https://api.example.com/user/profile',
            { api_key: 'sk-1234567890abcdef', password: 'secret123' },
            sensitiveResponse,
            'getProfile',
            'Get User Profile with Sensitive Data'
        );

        console.info(`  ${chalk.bold("Masked data stored as:")} ${chalk.white(maskedFilename)}`);
        console.info(`  ${chalk.bold("Sensitive fields masked with MD5 hashes")}`);
        console.info(`  ${chalk.dim("Original values are NOT stored - only hashes for matching")}`);
        console.info("");

    } catch (error) {
        console.error(chalk.red("❌ Error:"), error);
    } finally {
        // Cleanup
        console.info(chalk.bold("🧹 Cleanup"));
        console.info(chalk.dim("─".repeat(50)));

        if (mockServer) {
            try {
                await mockServer.stop();
                console.info(`  ${chalk.green("✓ MockServer stopped successfully")}`);
            } catch (error) {
                console.error(`  ${chalk.red("✗ Error stopping server:")} ${error}`);
            }
        } else {
            console.info(`  ${chalk.yellow("⚠ No server to stop (likely failed to start)")}`);
        }

        console.info("");
        console.info(chalk.green("🎉 MockServer demonstration completed!"));
        console.info("");
        console.info(chalk.dim("💡 Key Features Demonstrated:"));
        console.info(chalk.dim("  • Starting and stopping mock HTTP servers"));
        console.info(chalk.dim("  • Capturing and storing mock responses"));
        console.info(chalk.dim("  • Request/response matching with FileDatabase"));
        console.info(chalk.dim("  • Configurable sensitive data masking"));
        console.info(chalk.dim("  • Server statistics and maintenance"));
        console.info(chalk.dim("  • Integration with HttpClient for testing"));
        console.info("");

        // Ensure process exits
        process.exit(0);
    }
}

main().catch((error) => {
    console.error(chalk.red("❌ Fatal error:"), error);
    process.exit(1);
});
