#!/usr/bin/env node

/**
 * Simple navigation example - demonstrates basic screen navigation with arrow keys
 * 
 * Command line to run this example:
 * npx tsx examples/screen/simple-navigation.ts
 */

import { 
    showScreen, 
    ScreenRow, 
    useState, 
    useEffect, 
    Box, 
    Text, 
    h 
} from "@nmakarov/cli-toolkit/screen";
import { init } from "@nmakarov/cli-toolkit/init";

/**
 * Simple three-screen navigation example
 */
const flow = async (context) => {
    const { logger } = context;

    logger.info("Starting simple navigation example");

    await showScreen({
        title: "Simple Navigation",
        onRender: (ctx) => {
            // Set up key bindings immediately (before component renders)
            // This ensures they're available when the footer is built
            ctx.setKeyBinding([
                {
                    key: "rightArrow",
                    caption: "next screen",
                    action: "next",
                    order: 0
                },
                {
                    key: "leftArrow",
                    caption: "previous screen",
                    action: "prev",
                    order: 0
                }
            ]);

            // Use React state to track current screen
            const ScreenContent = () => {
                const [currentScreen, setCurrentScreen] = useState(1);

                // Set up actions in useEffect (runs once after mount)
                useEffect(() => {
                    // Define navigation actions
                    ctx.setAction("next", () => {
                        setCurrentScreen(prev => {
                            if (prev < 3) {
                                return prev + 1;
                            }
                            return prev;
                        });
                    });

                    ctx.setAction("prev", () => {
                        setCurrentScreen(prev => {
                            if (prev > 1) {
                                return prev - 1;
                            }
                            return prev;
                        });
                    });
                }, []); // Empty dependency array - run once

                // Render current screen content
                return h(Box, { flexDirection: "column" },
                    h(ScreenRow, {}, h(Text, {}, `Screen ${currentScreen}`)),
                    h(ScreenRow, {}, h(Text, {}, " ")),
                    h(ScreenRow, {}, h(Text, {}, "Use left/right arrows to move between screens"))
                );
            };

            return h(ScreenContent, {});
        }
    });

    logger.info("Navigation example completed");
};

// Initialize and run the flow
init(flow, {
    logger: {
        mode: "text",
        route: "console",
    },
});

