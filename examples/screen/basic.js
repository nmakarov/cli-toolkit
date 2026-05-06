#!/usr/bin/env node

/**
 * Basic example - demonstrates screen system features
 * 
 * Command lines to run this example:
 * npx tsx examples/screen/basic.ts
 */

import React, { } from "react";
import { Box, Text } from "ink";
import { showScreen, showListScreen, showMultiColumnListWithPreviewScreen } from "@nmakarov/cli-toolkit/screen";
import { buildBreadcrumb, buildDetailBreadcrumb } from "@nmakarov/cli-toolkit/screen";
import { ScreenRow, } from "@nmakarov/cli-toolkit/screen";
import { TextBlock, } from "@nmakarov/cli-toolkit/screen";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { exec } from "child_process";
import { promisify } from "util";

const { createElement: h } = React;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const execAsync = promisify(exec);

// Import sample data
import sampleWordsData from "./sample-words.json" with { type: "json" };










const sampleWords = sampleWordsData;

/**
 * Info screen
 */
async function showInfoScreen() {
    return await showScreen({
        title: buildBreadcrumb(["Menu", "Info"]),
        onRender: (ctx) => {
            const InfoComponent = () => {
                return h(Box, { flexDirection: "column" },
                    h(ScreenRow, {}, h(Text, {}, "This is V2 Action-Based Architecture")),
                    h(ScreenRow, {}, h(Text, {}, " ")),
                    h(ScreenRow, {}, h(Text, {}, "Features:")),
                    h(ScreenRow, {}, h(Text, {}, "  • Declarative key bindings")),
                    h(ScreenRow, {}, h(Text, {}, "  • Auto-generated footer")),
                    h(ScreenRow, {}, h(Text, {}, "  • Action-based handlers")),
                    h(ScreenRow, {}, h(Text, {}, "  • Closure-based state access"))
                );
            };

            return h(InfoComponent, {});
        }
    });
}

/**
 * TextBlock component demo
 */
async function showTextBlockDemo() {
    return await showScreen({
        title: buildBreadcrumb(["Menu", "TextBlock Demo"]),
        onRender: (ctx) => {
            const TextBlockDemoComponent = () => {
                return h(Box, { flexDirection: "column" },
                    h(ScreenRow, {}, h(TextBlock, { content: "Welcome to TextBlock Demo!", bold: true })),
                    h(ScreenRow, {}, h(Text, {}, " ")),
                    h(ScreenRow, {}, h(TextBlock, { content: "This is normal text" })),
                    h(ScreenRow, {}, h(TextBlock, { content: "This is bold text", bold: true })),
                    h(ScreenRow, {}, h(TextBlock, { content: "This is cyan text", color: "cyan" })),
                    h(ScreenRow, {}, h(TextBlock, { content: "This is dimmed text", dimmed: true })),
                    h(ScreenRow, {}, h(TextBlock, { content: "This is green and bold text", color: "green", bold: true })),
                    h(ScreenRow, {}, h(Text, {}, " ")),
                    h(ScreenRow, {}, h(TextBlock, { content: "Multi-line text example:\nThis is line two\nAnd this is line three!\n\nYou can use multiple lines with newline characters.", color: "yellow" })),
                    h(ScreenRow, {}, h(Text, {}, " ")),
                    h(ScreenRow, {}, h(TextBlock, { content: "TextBlock is a versatile component for displaying styled text blocks with various formatting options.", dimmed: true }))
                );
            };

            return h(TextBlockDemoComponent, {});
        }
    });
}

/**
 * Word card with audio playback
 */
async function showWordCard(word) {
    const wordData = sampleWords[word];
    const hasAudio = wordData.sound !== null;

    return showScreen({
        title: buildDetailBreadcrumb(["Menu", "Words", `"${word}"`], "Details"),
        onRender: (ctx) => {
            // Shared state ref for audio playback
            const isPlayingRef = { current: false };

            // Set up audio action if audio is available
            if (hasAudio) {

                ctx.setAction("playAudio", async () => {
                    isPlayingRef.current = true;
                    ctx.update();

                    const soundPath = join(__dirname, "sounds", wordData.sound);

                    try {
                        if (process.platform === "darwin") {
                            await execAsync(`afplay "${soundPath}"`);
                        } else if (process.platform === "linux") {
                            await execAsync(`mpg123 -q "${soundPath}"`).catch(() =>
                                execAsync(`ffplay -nodisp -autoexit -loglevel quiet "${soundPath}"`)
                            );
                        }
                    } catch (err) {
                        // Ignore playback errors
                    }

                    isPlayingRef.current = false;
                    ctx.update();
                });

                // Set up key binding with dynamic caption
                ctx.setKeyBinding({
                    key: "p",
                    caption: () => {
                        if (isPlayingRef.current) {
                            // Return styled component - replaces entire "p to play sound"
                            return h(Text, {
                                color: "black",
                                backgroundColor: "green",
                                bold: true
                            }, " PLAYING ");
                        }
                        // Return string - will be formatted as "p to play sound"
                        return "play sound";
                    },
                    action: "playAudio",
                    order: 10
                });
            }

            // Now create component
            const WordCardComponent = () => {
                return h(Box, { flexDirection: "column" },
                    h(ScreenRow, {}, h(Text, { color: "cyan", bold: true }, word.toUpperCase())),
                    h(ScreenRow, {}, h(Text, {}, " ")),
                    h(ScreenRow, {}, h(Text, { bold: true }, "Definition:")),
                    h(ScreenRow, {}, h(Text, {}, wordData.definition)),
                    h(ScreenRow, {}, h(Text, {}, " ")),
                    h(ScreenRow, {}, h(Text, { dimColor: true }, hasAudio ? "♪ Audio available" : "No audio available"))
                );
            };

            return h(WordCardComponent, {});
        }
    });
}

/**
 * Simple list - Array of strings
 */
async function showSimpleList() {
    const items = [
        "Apple",
        "Banana",
        "Cherry",
        "Date",
        "Elderberry",
        "Fig",
        "Grape"
    ];

    let selectedIndex = 0;

    while (true) {
        const item = await showListScreen({
            title: buildBreadcrumb(["Menu", "Simple List"]),
            items: items.map((item) => ({ name: item, value: item })),
            initialSelectedIndex: selectedIndex,
            onSelect: (value, index) => {
                selectedIndex = index;
                return value;
            },
            onEscape: (index) => {
                selectedIndex = index;
                return null;
            }
        });

        if (!item) break;

        // Show selection message
        await showScreen({
            title: buildDetailBreadcrumb(["Menu", "Simple List", `"${item}"`], "Details"),
            onRender: (ctx) => {
                // Set up escape action to close
                ctx.setAction("back", () => {
                    ctx.close();
                });

                // Set up key bindings
                ctx.setKeyBinding([
                    { key: "escape", caption: "back", action: "back", order: 0 },
                    { key: "leftArrow", caption: "back", action: "back", order: 0 }
                ]);

                return h(Box, { flexDirection: "column" },
                    h(ScreenRow, {}, h(Text, {}, `You selected: ${item}`)),
                    h(ScreenRow, {}, h(Text, {}, " ")),
                    h(ScreenRow, {}, h(Text, {}, "Press esc or ← to continue..."))
                );
            }
        });
    }
}

/**
 * Advanced list - Array of objects with custom rendering
 */
async function showAdvancedList() {
    const items = [
        { title: "JavaScript", description: "High-level programming language" },
        { title: "TypeScript", description: "Typed superset of JavaScript" },
        { title: "Python", description: "Interpreted high-level programming language" },
        { title: "Go", description: "Statically typed compiled language" },
        { title: "Rust", description: "Systems programming language" },
        { title: "Java", description: "Object-oriented programming language" },
        { title: "C#", description: "Object-oriented programming language" },
        { title: "C++", description: "General-purpose programming language" },
        { title: "Swift", description: "Apple's programming language" },
        { title: "Kotlin", description: "JVM programming language" }
    ];

    let selectedIndex = 0;

    while (true) {
        const item = await showListScreen({
            title: buildBreadcrumb(["Menu", "Advanced List"]),
            items: items.map((item) => ({ name: item.title, value: item })),
            maxHeight: 8, // Limit to 8 items visible at once
            initialSelectedIndex: selectedIndex,
            onSelect: (value, index) => {
                selectedIndex = index;
                return value;
            },
            onEscape: (index) => {
                selectedIndex = index;
                return null;
            },
            // Custom renderer for two-line display (scroll indicators handled by default renderer)
            renderItem: (item, isSelected, displayIndex) => {
                const data = item.value ;
                
                return h(ScreenRow, {},
                    h(Box, { flexDirection: "column" },
                        h(Box, { flexDirection: "row" },
                            // Item title (highlighted if selected)
                            h(Text, {
                                color: isSelected ? "black" : "white",
                                backgroundColor: isSelected ? "cyan" : undefined,
                                bold: isSelected
                            }, data.title)
                        ),
                        h(Text, { dimColor: true }, `    ${data.description}`)
                    )
                );
            },
            // Enable sorting
            sortable: true,
            // Custom getTitle function
            getTitle: (item) => {
                const data = item.value ;
                return data.title;
            }
        });

        if (!item) break;

        // Show selection message
        await showScreen({
            title: buildDetailBreadcrumb(["Menu", "Advanced List", `"${(item ).title}"`], "Details"),
            onRender: (ctx) => {
                // Set up escape action to close
                ctx.setAction("back", () => {
                    ctx.close();
                });

                // Set up key bindings
                ctx.setKeyBinding([
                    { key: "escape", caption: "back", action: "back", order: 0 },
                    { key: "leftArrow", caption: "back", action: "back", order: 0 }
                ]);

                const data = item ;
                return h(Box, { flexDirection: "column" },
                    h(ScreenRow, {}, h(Text, { bold: true }, `Title: ${data.title}`)),
                    h(ScreenRow, {}, h(Text, { dimColor: true }, `Description: ${data.description}`)),
                    h(ScreenRow, {}, h(Text, {}, " ")),
                    h(ScreenRow, {}, h(Text, {}, "Press esc or ← to continue..."))
                );
            }
        });
    }
}

/**
 * Word list - Simple list view
 */
async function showWordList() {
    // Get word keys from sampleWords (already imported)
    const wordKeys = Object.keys(sampleWords);

    let selectedIndex = 0;

    while (true) {
        const word = await showListScreen({
            title: buildBreadcrumb(["Menu", "Word List"]),
            items: wordKeys.slice(0, 50).map((word) => ({
                name: word,
                value: { word, translation: "See definition", definition: sampleWords[word].definition }
            })),
            maxHeight: 15, // Limit to 15 items visible at once
            initialSelectedIndex: selectedIndex,
            onSelect: (value, index) => {
                selectedIndex = index;
                return value;
            },
            onEscape: (index) => {
                selectedIndex = index;
                return null;
            },
            // Custom renderer for word display (scroll indicators handled by ListComponent)
            renderItem: (item, isSelected, displayIndex) => {
                return h(Box, { flexDirection: "column" },
                    h(Box, { flexDirection: "row" },
                        // Item name (highlighted if selected)
                        h(Text, {
                            color: isSelected ? "black" : "white",
                            backgroundColor: isSelected ? "cyan" : undefined,
                            bold: isSelected
                        }, item.name)
                    ),
                    h(Text, { dimColor: true }, [
                        "    ",
                        h(Text, { dimColor: true, color: "green" }, "Definition: "),
                        (item.value ).definition
                    ])
                );
            }
        });

        if (!word) break;

        await showWordCard(word.word);
    }
}

/**
 * Word list with preview panel
 */
async function showWordListWithPreview() {
    const wordKeys = Object.keys(sampleWords);
    let selectedIndex = 0;

    while (true) {
        const word = await showMultiColumnListWithPreviewScreen({
            title: buildBreadcrumb(["Menu", "Words with Preview"]),
            items: wordKeys,
            initialSelectedIndex: selectedIndex,
            getPreviewContent: (word) => {
                const data = sampleWords[word];
                return {
                    Word: word,
                    Definition: data.definition,
                    Audio: data.sound ? "♪ Available" : "Not available"
                };
            },
            onSelect: (w, index) => {
                selectedIndex = index;
                return w;
            },
            onEscape: (index) => {
                selectedIndex = index;
                return null;
            }
        });

        if (!word) break;

        await showWordCard(word);
    }
}

/**
 * Main menu
 */
async function showMainMenu() {
    let selectedIndex = 0;

    while (true) {
        const choice = await showListScreen({
            title: buildBreadcrumb(["Menu"]),
            items: [
                { name: "Info Screen", value: "info" },
                { name: "TextBlock Demo", value: "textblock" },
                { name: "Simple List", value: "simple" },
                { name: "Advanced List", value: "advanced" },
                { name: "Word List (50 words)", value: "list" },
                { name: "Word List with Preview", value: "preview" },
                { name: "Exit", value: "exit" }
            ],
            initialSelectedIndex: selectedIndex,
            onSelect: (value, index) => {
                selectedIndex = index;
                return value;
            },
            onEscape: (index) => {
                selectedIndex = index;
                return "exit";
            }
        });

        if (choice === "exit" || choice === null) break;

        switch (choice) {
            case "info":
                await showInfoScreen();
                break;
            case "textblock":
                await showTextBlockDemo();
                break;
            case "simple":
                await showSimpleList();
                break;
            case "advanced":
                await showAdvancedList();
                break;
            case "list":
                await showWordList();
                break;
            case "preview":
                await showWordListWithPreview();
                break;
        }
    }
}

// Main entry point
console.log("\n=== Screen System Example ===\n");
console.log("Demonstrating interactive screen features...\n");

showMainMenu().then(() => {
    console.log("\n✓ Example completed\n");
    process.exit(0);
}).catch((err) => {
    console.error("Error:", err);
    process.exit(1);
});
