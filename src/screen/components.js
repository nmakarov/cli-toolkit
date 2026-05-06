/**
 * Core screen layout components
 */

import { createElement as h } from "react";
import { Box, Text } from "ink";

/**
 * Get screen width for borders
 * @param maxWidth - Optional max width (null = no limit)
 */
export function getScreenWidth(maxWidth = null) {
    const terminalWidth = process.stdout.columns || 80;
    // Leave some margin for borders and padding
    const availableWidth = Math.max(20, terminalWidth - 4);
    return maxWidth ? Math.min(availableWidth, maxWidth) : availableWidth;
}

// Types






























/**
 * Screen Container - uses Ink's built-in borderStyle for proper text wrapping
 */
export function ScreenContainer({ children }) {
    const width = getScreenWidth();

    return h(Box, {
        flexDirection: "column",
        marginTop: 1,
        borderStyle: "single",
        borderColor: "cyan",
        paddingX: 1,
        width: width  // Use the calculated width directly
    }, children);
}

/**
 * Screen row - just a wrapper for spacing, borders handled by container
 */
export function ScreenRow({ children }) {
    return h(Box, { flexDirection: "column" }, children);
}

/**
 * Screen Title - first line inside container (left-aligned, breadcrumb-style)
 */
export function ScreenTitle({ text }) {
    return h(ScreenRow, {},
        h(Text, { bold: true, color: "cyan" }, text)
    );
}

/**
 * Horizontal divider line
 */
export function ScreenDivider({ width }) {
    const dividerWidth = width || (getScreenWidth() - 4); // Account for border and padding
    return h(Text, { color: "cyan", dimColor: true }, "─".repeat(dividerWidth));
}

/**
 * Screen Body - main content area
 */
export function ScreenBody({ children, alignItems = "flex-start" }) {
    return h(Box, { flexDirection: "column", alignItems }, children);
}

/**
 * Screen Footer - bottom area with key bindings and status
 * 
 * @example
 * <ScreenFooter lines={["esc to go back", "enter to select"]} />
 * 
 * @example
 * <ScreenFooter 
 *   lines={["esc to go back", "enter to select"]} 
 *   textStyle={{ color: "white" }}
 * />
 * 
 * @example
 * <ScreenFooter 
 *   lines={["esc to go back", "enter to select"]} 
 *   textStyle={{ dimColor: false, color: "green" }}
 * />
 */
export function ScreenFooter({ lines, textStyle }) {
    const defaultTextStyle = {
        dimColor: true,
        color: "white"
    };
    
    const finalTextStyle = { ...defaultTextStyle, ...textStyle };

    // Flatten nested arrays and ensure all items are properly wrapped
    const flattenAndWrap = (items, keyPrefix = "") => {
        const result = [];
        let keyIndex = 0;

        items.forEach((item, index) => {
            if (Array.isArray(item)) {
                // Handle nested arrays
                const nested = flattenAndWrap(item, `${keyPrefix}-${index}`);
                result.push(...nested);
            } else if (typeof item === "string") {
                // Wrap strings in Text components
                result.push(
                    h(Text, { key: `${keyPrefix}-${keyIndex++}`, ...finalTextStyle }, item)
                );
            } else {
                // JSX elements - add key if missing
                const element = item ;
                if (element.key === null || element.key === undefined) {
                    result.push(
                        h(Text, { key: `${keyPrefix}-${keyIndex++}`, ...finalTextStyle }, element)
                    );
                } else {
                    result.push(element);
                }
            }
        });

        return result;
    };

    const wrappedItems = flattenAndWrap(lines);

    return h(Box, { flexDirection: "column" },
        h(Box, { flexDirection: "row" }, ...wrappedItems)
    );
}