/**
 * Footer builder - composes footer messages from multiple sources
 */









/**
 * Build footer lines from multiple message sources
 *
 * @param config - Footer configuration object
 * @returns Array of footer lines
 */
export function buildFooter(config = {}) {
    const {
        navigation = null,
        actions = null,
        info = null,
        escape = "Esc to go back",
        custom = null
    } = config;

    const lines = [];

    // Build main help line (navigation + actions + escape)
    const mainParts = [];

    if (navigation) {
        mainParts.push(navigation);
    }

    if (actions) {
        mainParts.push(actions);
    }

    if (escape) {
        mainParts.push(escape);
    }

    if (mainParts.length > 0) {
        lines.push(mainParts.join(", "));
    }

    // Add info line if present
    if (info) {
        const infoLines = Array.isArray(info) ? info : [info];
        lines.push(...infoLines);
    }

    // Add custom lines if present
    if (custom) {
        const customLines = Array.isArray(custom) ? custom : [custom];
        lines.push(...customLines);
    }

    return lines;
}

/**
 * Predefined footer configurations for common screen types
 */
export const FooterPresets = {
    /**
     * Menu screen footer
     */
    menu: (customInfo = null) => buildFooter({
        navigation: "↑/↓ to navigate",
        actions: "Enter to select",
        escape: "Esc to go back",
        info: customInfo
    }),

    /**
     * Word grid footer
     */
    wordGrid: (totalWords) => buildFooter({
        navigation: "↑↓←→ to navigate",
        actions: "Enter to select",
        escape: "Esc to go back",
        info: `Total: ${totalWords} words`
    }),

    /**
     * Text input footer
     */
    textInput: () => buildFooter({
        actions: "Type and press Enter to submit",
        escape: "Esc to cancel"
    }),

    /**
     * Info/static screen footer
     */
    info: () => buildFooter({
        escape: "Esc to continue"
    }),

    /**
     * Main menu footer (escape exits)
     */
    mainMenu: () => buildFooter({
        navigation: "↑/↓ to navigate",
        actions: "Enter to select",
        escape: "Esc to exit"
    }),

    /**
     * Action menu footer (for word cards, etc.)
     */
    actionMenu: (hasAudio = false) => {
        const parts = buildFooter({
            navigation: "↑/↓ to navigate",
            actions: "Enter to select",
            escape: "Esc to go back"
        });

        if (hasAudio) {
            parts.push("Audio available");
        }

        return parts;
    }
};

/**
 * Combine multiple footer messages into organized lines
 * Smart grouping of related messages
 *
 * @param messages - Individual footer messages
 * @returns Organized footer lines
 */
export function organizeFooterMessages(messages) {
    if (!messages || messages.length === 0) {
        return ["Esc to go back"];
    }

    // Group similar messages
    const navigation = messages.filter(m => m.includes("↑") || m.includes("↓") || m.includes("←") || m.includes("→"));
    const actions = messages.filter(m => m.includes("Enter") || m.includes("select") || m.includes("submit"));
    const escape = messages.filter(m => m.includes("Esc"));
    const others = messages.filter(m =>
        !navigation.includes(m) &&
        !actions.includes(m) &&
        !escape.includes(m)
    );

    const lines = [];

    // Combine navigation, actions, and escape on one line
    const mainLine = [...navigation, ...actions, ...escape].join(", ");
    if (mainLine) lines.push(mainLine);

    // Add other messages as separate lines
    lines.push(...others);

    return lines;
}
