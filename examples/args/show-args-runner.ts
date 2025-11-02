#!/usr/bin/env node

// Interactive Args example runner with screen UI
//
// Command line usage:
// npx tsx examples/args/show-args-runner.ts

import { spawn } from "child_process";
import { showScreen, showListScreen, buildBreadcrumb } from "../../src/screen/index.js";
import React, { createElement as h } from "react";
import { Text, Box } from "ink";

// Define available examples
const examples = [
    {
        id: "1",
        title: "No Arguments",
        command: "npx tsx examples/args/show-args.ts",
        description: "Shows discovered values with no arguments"
    },
    {
        id: "2",
        title: "Silent Flag",
        command: "npx tsx examples/args/show-args.ts --silent",
        description: "Shows discovered values with --silent flag"
    },
    {
        id: "3",
        title: "Verbose & Output",
        command: "npx tsx examples/args/show-args.ts --verbose --output=file.txt",
        description: "Shows discovered values with --verbose and --output"
    },
    {
        id: "4",
        title: "Short Aliases",
        command: "npx tsx examples/args/show-args.ts -v -o=file.txt",
        description: "Shows discovered values using short form aliases"
    },
    {
        id: "5",
        title: "Commands & Flags",
        command: "npx tsx examples/args/show-args.ts build --verbose --output=dist/",
        description: "Shows discovered values with commands and mixed flags"
    },
    {
        id: "6",
        title: "Quoted Arguments",
        command: "npx tsx examples/args/show-args.ts --message=\"Hello World\" --key=\"5=five\"",
        description: "Shows discovered values with quoted arguments"
    },
    {
        id: "7",
        title: "Help Flag",
        command: "npx tsx examples/args/show-args.ts --help",
        description: "Shows discovered values with help flag"
    },
    {
        id: "8",
        title: "Environment Variable",
        command: "HELP=true npx tsx examples/args/show-args.ts",
        description: "Shows discovered values with help env variable"
    }
];

const runExample = async (example: typeof examples[0]): Promise<string> => {
    return new Promise((resolve, reject) => {
        const [command, ...args] = example.command.split(" ");
        const child = spawn(command, args, {
            stdio: "pipe",
            shell: true
        });

        let outputData = "";

        child.stdout?.on("data", (data) => {
            outputData += data.toString();
        });

        child.stderr?.on("data", (data) => {
            outputData += data.toString();
        });

        child.on("close", () => {
            resolve(outputData);
        });

        child.on("error", (error) => {
            reject(new Error(`Failed to run example: ${error.message}`));
        });
    });
};

const showRunningAndOutputScreen = async (example: typeof examples[0]) => {
    let output = "";
    let hasError = false;

    try {
        output = await runExample(example);
    } catch (error: any) {
        output = `Error: ${error.message}`;
        hasError = true;
    }

    await showScreen({
        title: buildBreadcrumb(["Args Runner", example.title, hasError ? "Error" : "Output"]),
        onRender: (ctx) => {
            ctx.setAction("back", () => ctx.close(null));
            ctx.setKeyBinding({ key: "leftArrow", caption: "go back", action: "back", order: 1 });

            return h(Box, { flexDirection: "column", padding: 1 },
                h(Text, { color: hasError ? "red" : "green", bold: true }, "Command:"),
                h(Text, { color: "white" }, `${hasError ? "Failed" : "Executed"}: ${example.command}`),
                h(Text, {}),
                h(Text, { color: hasError ? "red" : "cyan", bold: true }, hasError ? "Error:" : "Output:"),
                h(Text, { color: hasError ? "red" : "white" }, output.trim() || "(no output)")
            );
        }
    });
};

const showMainMenu = async () => {
    return showListScreen({
        title: buildBreadcrumb(["Args Runner"]),
        items: examples.map(example => ({ name: `${example.id}. ${example.title}`, value: example })),
        getTitle: (item) => `${item.name}`,
        renderItem: (item, isSelected) => {
            const example = item.value as typeof examples[0];
            return h(Box, { flexDirection: "column" },
                h(Text, {
                    color: isSelected ? "green" : "white",
                    bold: isSelected
                }, `${example.id}. ${example.command}`),
                h(Text, { dimColor: true }, `   ${example.description}`)
            );
        },
        onSelect: (item) => item as typeof examples[0],
        onEscape: () => null,
        footer: "↑↓ to navigate, enter to run, esc / ← to exit"
    });
};

const main = async () => {
    try {
        while (true) {
            const selected = await showMainMenu();
            if (!selected) {
                break;
            }
            await showRunningAndOutputScreen(selected as typeof examples[0]);
        }
    } catch (error) {
        console.error("Error:", error);
        process.exit(1);
    }
};

main();


