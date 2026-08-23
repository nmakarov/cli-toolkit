/**
 * Core screen layout components
 */

import React, { createElement as h } from "react";
import { Box, Text } from "ink";
import { stripAnsi } from "./visible-text.js";

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

/** Bold key label. Do not use dimColor here — dim and bold share SGR 22. */
export const FOOTER_HOTKEY_STYLE = { bold: true };

/** Caption / separator. Gray, not dim, so later keys stay bold. */
export const FOOTER_MUTED_STYLE = { color: "gray" };

/**
 * Normalize one footer item: `{ hotkey, caption }` (aliases: key, title, text).
 * `hotkey` may be a string (`"esc/←"`) or an array of labels.
 */
export function normalizeFooterHotkey(item) {
    if (item == null) return null;
    if (typeof item === "string") {
        return { hotkey: [item], caption: "" };
    }
    const raw = item.hotkey ?? item.key;
    const hotkey = Array.isArray(raw)
        ? raw.map(String)
        : String(raw ?? "").split("/").map((s) => s.trim()).filter(Boolean);
    return {
        ...item,
        hotkey,
        caption: item.caption ?? item.title ?? item.text ?? "",
    };
}

function renderHotkeyPieces(item, reactKey) {
    const normalized = normalizeFooterHotkey(item);
    if (!normalized) return [];
    if (normalized.node && React.isValidElement(normalized.node)) {
        return [
            normalized.node.key == null
                ? React.cloneElement(normalized.node, { key: reactKey })
                : normalized.node,
        ];
    }

    const pieces = [];
    normalized.hotkey.forEach((label, i) => {
        if (i > 0) {
            pieces.push(h(Text, { key: `${reactKey}-sep${i}`, ...FOOTER_MUTED_STYLE }, "/"));
        }
        pieces.push(h(Text, { key: `${reactKey}-k${i}`, ...FOOTER_HOTKEY_STYLE }, label));
    });

    if (normalized.caption) {
        pieces.push(h(Text, { key: `${reactKey}-cap`, ...FOOTER_MUTED_STYLE }, ` to ${normalized.caption}`));
    }

    if (normalized.kind === "toggle" && normalized.value) {
        pieces.push(h(Text, { key: `${reactKey}-sp`, ...FOOTER_MUTED_STYLE }, " "));
        pieces.push(h(
            Text,
            { key: `${reactKey}-val`, ...(normalized.valueStyle || FOOTER_HOTKEY_STYLE) },
            ` ${normalized.value} `,
        ));
    }

    return pieces;
}

/**
 * Screen Footer — hotkeys are structured items, styled here (not parsed from a string).
 *
 * @example
 * <ScreenFooter hotkeys={[
 *   { hotkey: ["esc", "←"], caption: "go back" },
 *   { hotkey: "enter", caption: "select" },
 *   { hotkey: "s", caption: "sort", kind: "toggle", value: "ASC" },
 * ]} />
 *
 * Extra status lines (not hotkeys) still go in `lines`.
 */
export function ScreenFooter({ hotkeys, lines, textStyle }) {
    const defaultTextStyle = {
        dimColor: true,
        color: "white"
    };
    
    const finalTextStyle = { ...defaultTextStyle, ...textStyle };

    const flattenAndWrap = (items, keyPrefix = "") => {
        const result = [];
        let keyIndex = 0;

        (items || []).forEach((item, index) => {
            if (Array.isArray(item)) {
                const nested = flattenAndWrap(item, `${keyPrefix}-${index}`);
                result.push(...nested);
            } else if (typeof item === "string") {
                const preStyled = stripAnsi(item) !== item;
                result.push(
                    h(Text, {
                        key: `${keyPrefix}-${keyIndex++}`,
                        ...(preStyled ? {} : finalTextStyle),
                    }, item)
                );
            } else if (React.isValidElement(item)) {
                result.push(
                    item.key == null
                        ? React.cloneElement(item, { key: `${keyPrefix}-${keyIndex++}` })
                        : item
                );
            } else if (item != null) {
                result.push(item);
            }
        });

        return result;
    };

    const hotkeyPieces = [];
    (hotkeys || []).forEach((item, idx) => {
        if (idx > 0) {
            hotkeyPieces.push(h(Text, { key: `hk-join-${idx}`, ...FOOTER_MUTED_STYLE }, ", "));
        }
        hotkeyPieces.push(...renderHotkeyPieces(item, `hk-${idx}`));
    });

    const extraRows = (lines && lines.length)
        ? flattenAndWrap(lines, "line")
        : [];

    const rows = [];
    if (hotkeyPieces.length) {
        rows.push(h(Box, { key: "hotkeys", flexDirection: "row" }, ...hotkeyPieces));
    }
    if (extraRows.length) {
        rows.push(h(Box, { key: "lines", flexDirection: "row" }, ...extraRows));
    }

    return h(Box, { flexDirection: "column" }, ...rows);
}