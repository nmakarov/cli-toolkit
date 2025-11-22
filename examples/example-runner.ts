#!/usr/bin/env node

import { spawn } from "child_process";
import { showScreen, showListScreen, buildBreadcrumb } from "../src/screen/index.js";
import React, { createElement as h } from "react";
import { Text, Box } from "ink";

// CLI Toolkit – unified example launcher with screen UI
//
// Run with: npx tsx examples/example-runner.ts

interface ExampleVariant {
    id: string;
    title: string;
    command: string;
    description: string;
    interactive?: boolean;
}

interface ExampleGroup {
    id: string;
    title: string;
    description: string;
    examples: ExampleVariant[];
}

const exampleGroups: ExampleGroup[] = [
    {
        id: "args",
        title: "Args Toolkit",
        description: "Discover how the argument parser behaves across different scenarios.",
        examples: [
            {
                id: "args-default",
                title: "Show Args – default",
                command: "npx tsx examples/args/show-args.ts",
                description: "Inspect discovered values with the default CLI inputs."
            },
            {
                id: "args-silent",
                title: "Show Args – silent mode",
                command: "npx tsx examples/args/show-args.ts --silent",
                description: "Toggle boolean flags using long options."
            },
            {
                id: "args-bundle",
                title: "Show Args – bundled short flags",
                command: "npx tsx examples/args/show-args.ts -vsd --output=dist/summary.txt",
                description: "Demonstrates short flag bundling with an additional option."
            },
            {
                id: "args-runner",
                title: "Args Runner UI",
                command: "npx tsx examples/args/show-args-runner.ts",
                description: "Launch the interactive Args example selector built with the screen system.",
                interactive: true
            }
        ]
    },
    {
        id: "params",
        title: "Params Library",
        description: "Validate configuration using type-safe parameter definitions.",
        examples: [
            {
                id: "params-required",
                title: "Show Params – all required",
                command: "npx tsx examples/params/show-params.ts --name=\"My App\" --port=8080 --debug=true --timeout=5000 --tags=\"api,web\" --numbers=\"10,20\" --flags=\"true,false\" --startDate=\"-1h\" --features=\"auth,logging\" --choice=\"option1\" --logLevel=\"info\" --dbHost=\"localhost\" --dbPort=5432 --dbName=\"mydb\" --apiTimeout=30000 --apiRetries=3 --apiEnabled=true --maxConnections=100 --retryDelay=1000 --enableCache=false",
                description: "Demonstrate params with all required fields (no defaults)."
            },
            {
                id: "params-defaults",
                title: "Show Params – with defaults",
                command: "npx tsx examples/params/show-params-defaults.ts --name=\"Analytics\" --dbName=\"analytics\"",
                description: "Run Params showcase with sensible defaults and minimal required input."
            },
            {
                id: "params-custom",
                title: "Show Params – custom values",
                command: "npx tsx examples/params/show-params-defaults.ts --name=\"Custom\" --port=9000 --features=\"auth,logging,metrics\" --maxConnections=200",
                description: "Pass explicit values to override defaults and see validation in action."
            }
        ]
    },
    {
        id: "screen",
        title: "Screen System",
        description: "Explore the interactive terminal UI components powered by Ink.",
        examples: [
            {
                id: "screen-basic",
                title: "Screen Demo – component tour",
                command: "npx tsx examples/screen/basic.ts",
                description: "Navigate through multiple screens, lists, and layouts in the demo app.",
                interactive: true
            }
        ]
    },
    {
        id: "logger",
        title: "Logger Module",
        description: "Try the new CLI logger in text, progress, and IPC routing modes.",
        examples: [
            {
                id: "logger-basic",
                title: "Logger – basic run",
                command: "npx tsx examples/logger/basic.ts",
                description: "Emit log levels, progress updates, and structured results."
            },
            {
                id: "logger-ipc",
                title: "Logger – IPC route",
                command: "npx tsx examples/logger/ipc.ts",
                description: "Demonstrate routing log output through the parent process channel."
            }
        ]
    },
    {
        id: "filedb",
        title: "FileDatabase Module",
        description: "Explore versioned file storage with chunking, pagination, and metadata.",
        examples: [
            {
                id: "filedb-basic",
                title: "FileDatabase – basic usage",
                command: "npx tsx examples/filestore/basic-usage.ts",
                description: "Write and read data with automatic versioning, pagination, and synopsis functions."
            },
            {
                id: "filedb-legacy",
                title: "FileDatabase – read legacy data",
                command: "npx tsx examples/filestore/read-legacy-data.ts",
                description: "Read old-format data without metadata.json using optimized metadata building."
            },
            {
                id: "filedb-inspect",
                title: "FileDatabase – inspect data",
                command: "npx tsx examples/filestore/inspect-data.ts --tableName=beaches/properties",
                description: "Analyze stored data with automatic type detection and comprehensive statistics."
            }
        ]
    },
    {
        id: "http-client",
        title: "HttpClient Module",
        description: "Explore resilient HTTP client with automatic retry and error handling.",
        examples: [
            {
                id: "http-client-basic",
                title: "HttpClient – basic usage",
                command: "npx tsx examples/http-client/basic-usage.ts",
                description: "Make HTTP requests with automatic retry, error classification, and unified responses."
            }
        ]
    },
    {
        id: "mock-server",
        title: "MockServer Module",
        description: "Explore HTTP mock server with FileDatabase integration for API testing.",
        examples: [
            {
                id: "mock-server-basic",
                title: "MockServer – basic usage",
                command: "npx tsx examples/mock-server/basic-usage.ts",
                description: "Start mock HTTP server, capture responses, and serve stored mocks for testing. Demonstrates proper cleanup and automatic exit."
            }
        ]
    },
    {
        id: "init",
        title: "Init Framework",
        description: "Framework initialization and flow execution with Args, Params, and Logger.",
        examples: [
            {
                id: "init-basic",
                title: "Init – basic usage",
                command: "npx tsx examples/init/basic.ts",
                description: "Initialize framework with Args, Params, and Logger, then execute a simple flow function."
            },
            {
                id: "init-params",
                title: "Init – with params",
                command: "npx tsx examples/init/params.ts --since=-2d",
                description: "Demonstrate parameter handling in flow function using Params.getAll()."
            },
            {
                id: "init-verbose",
                title: "Init – verbose mode",
                command: "npx tsx examples/init/basic.ts --verbose",
                description: "Show how CLI arguments are automatically available in flow function via Params."
            }
        ]
    }
];

const runCommandAndCapture = async (variant: ExampleVariant): Promise<string> => {
    return new Promise((resolve, reject) => {
        const child = spawn(variant.command, {
            stdio: "pipe",
            shell: true,
            env: process.env
        });

        let buffer = "";

        child.stdout?.on("data", (data) => {
            buffer += data.toString();
        });

        child.stderr?.on("data", (data) => {
            buffer += data.toString();
        });

        child.on("close", () => resolve(buffer));
        child.on("error", (error) => reject(new Error(`Failed to run example: ${error.message}`)));
    });
};

const showCapturedExampleResult = async (group: ExampleGroup, variant: ExampleVariant) => {
    let output = "";
    let hasError = false;

    try {
        output = await runCommandAndCapture(variant);
    } catch (error: any) {
        output = `Error: ${error.message}`;
        hasError = true;
    }

    await showScreen({
        title: buildBreadcrumb([group.title, variant.title, hasError ? "Error" : "Output"]),
        onRender: (ctx) => {
            ctx.setAction("back", () => ctx.close(null));
            ctx.setKeyBinding({ key: "leftArrow", caption: "go back", action: "back", order: 1 });

            return h(Box, { flexDirection: "column", padding: 1 },
                h(Text, { color: hasError ? "red" : "green", bold: true }, "Command:"),
                h(Text, { color: "white" }, `${hasError ? "Failed" : "Executed"}: ${variant.command}`),
                h(Text, {}),
                h(Text, { color: hasError ? "red" : "cyan", bold: true }, hasError ? "Error:" : "Output:"),
                h(Text, { color: hasError ? "red" : "white" }, output.trim() || "(no output)")
            );
        }
    });
};

const runInteractiveExample = async (group: ExampleGroup, variant: ExampleVariant) => {
    console.info("\n" + "=".repeat(60));
    console.info(`Launching interactive example from ${group.title}:`);
    console.info(variant.command);
    console.info("=".repeat(60) + "\n");

    await new Promise<void>((resolve, reject) => {
        const child = spawn(variant.command, {
            stdio: "inherit",
            shell: true,
            env: process.env
        });

        child.on("close", () => {
            console.info("\n" + "=".repeat(60));
            console.info("Interactive example finished. Returning to the launcher...");
            console.info("=".repeat(60) + "\n");
            resolve();
        });

        child.on("error", (error) => {
            console.error(`Failed to run example: ${error.message}`);
            reject(error);
        });
    });
};

const promptForExample = async (group: ExampleGroup) => {
    return showListScreen({
        title: buildBreadcrumb([group.title]),
        items: group.examples.map((variant) => ({ name: variant.title, value: variant })),
        renderItem: (item, isSelected) => {
            const variant = item.value as ExampleVariant;
            return h(Box, { flexDirection: "column" },
                h(Text, {
                    color: isSelected ? "cyan" : "white",
                    bold: isSelected
                }, variant.title),
                h(Text, { dimColor: true }, `   ${variant.command}`),
                h(Text, { dimColor: true }, `   ${variant.description}`)
            );
        },
        onSelect: (item) => item as ExampleVariant,
        onEscape: () => null
    });
};

const promptForGroup = async () => {
    return showListScreen({
        title: buildBreadcrumb(["CLI Toolkit Examples"]),
        items: exampleGroups.map((group) => ({ name: group.title, value: group })),
        renderItem: (item, isSelected) => {
            const group = item.value as ExampleGroup;
            return h(Box, { flexDirection: "column" },
                h(Text, {
                    color: isSelected ? "green" : "white",
                    bold: isSelected
                }, group.title),
                h(Text, { dimColor: true }, `   ${group.description}`)
            );
        },
        onSelect: (item) => item as ExampleGroup,
        onEscape: () => null
    });
};

const main = async () => {
    try {
        while (true) {
            const group = await promptForGroup();
            if (!group) {
                break;
            }

            while (true) {
                const variant = await promptForExample(group as ExampleGroup);
                if (!variant) {
                    break;
                }

                if ((variant as ExampleVariant).interactive) {
                    await runInteractiveExample(group as ExampleGroup, variant as ExampleVariant);
                } else {
                    await showCapturedExampleResult(group as ExampleGroup, variant as ExampleVariant);
                }
            }
        }
    } catch (error) {
        console.error("Error:", error);
        process.exit(1);
    }
};

main();
