/**
 * ScrollableText — wrap long text, line/page scroll, proportional scrollbar.
 *
 *   h(ScrollableText, { ctx, text: json, bindKeys: true })
 *
 * Keys (when bindKeys):
 *   ↑/↓         — one line
 *   ⌥↑/↓ ^↑/↓   — one page (ink `meta` ≈ Option/Alt; ⌘ often never reaches the TTY)
 *   PgUp/PgDn   — one page
 */

import { useState, useEffect, useMemo, useRef, createElement } from "react";
import { Box, Text } from "ink";
import { getScreenWidth } from "./components.js";

const h = createElement;

/** ASCII-only: full-block `█` is often double-width in terminals and forces a wrap. */
const BAR_THUMB = "#";
const BAR_TRACK = "|";

/**
 * Hard-wrap text to `cols` (keeps empty lines).
 * @param {string} text
 * @param {number} cols
 * @returns {string[]}
 */
export function wrapTextLines(text, cols) {
    const w = Math.max(1, Math.floor(Number(cols) || 1));
    const out = [];
    for (const raw of String(text ?? "").split("\n")) {
        if (raw.length === 0) {
            out.push("");
            continue;
        }
        let rest = raw;
        while (rest.length > w) {
            out.push(rest.slice(0, w));
            rest = rest.slice(w);
        }
        if (rest.length > 0) out.push(rest);
    }
    return out;
}

/**
 * Proportional scrollbar glyphs for a viewport.
 * @returns {string[]|null} one glyph per viewport row, or null when no overflow
 */
export function scrollbarGlyphs(viewportRows, totalLines, scrollTop) {
    const view = Math.max(1, Math.floor(viewportRows));
    const total = Math.max(0, Math.floor(totalLines));
    if (total <= view) return null;

    const maxScroll = total - view;
    const thumbSize = Math.max(1, Math.round((view / total) * view));
    const travel = Math.max(0, view - thumbSize);
    const s = Math.min(Math.max(0, Math.floor(scrollTop)), maxScroll);
    const thumbStart = maxScroll === 0 ? 0 : Math.round((s / maxScroll) * travel);

    const glyphs = [];
    for (let i = 0; i < view; i++) {
        glyphs.push(i >= thumbStart && i < thumbStart + thumbSize ? BAR_THUMB : BAR_TRACK);
    }
    return glyphs;
}

function padEndVisible(s, w) {
    const t = String(s ?? "");
    if (t.length >= w) return t.slice(0, w);
    return t + " ".repeat(w - t.length);
}

const SCROLL_KEYS = [
    { key: "upArrow", caption: "scroll", action: "scrollUp", order: 0 },
    { key: "downArrow", caption: "scroll", action: "scrollDown", order: 0 },
    { key: "upArrow", meta: true, caption: "page", action: "pageUp", order: 0 },
    { key: "downArrow", meta: true, caption: "page", action: "pageDown", order: 0 },
    { key: "upArrow", ctrl: true, caption: "page", action: "pageUp", order: 0 },
    { key: "downArrow", ctrl: true, caption: "page", action: "pageDown", order: 0 },
    { key: "pageUp", caption: "page", action: "pageUp", order: 0 },
    { key: "pageDown", caption: "page", action: "pageDown", order: 0 },
];

/**
 * @param {{
 *   ctx: object,
 *   text?: string,
 *   lines?: string[],
 *   maxHeight?: number,
 *   wrap?: boolean,
 *   showScrollbar?: boolean,
 *   showStatus?: boolean,
 *   bindKeys?: boolean,
 *   header?: unknown,
 * }} props
 */
export function ScrollableText({
    ctx,
    text = "",
    lines: linesProp,
    maxHeight,
    wrap = true,
    showScrollbar = true,
    showStatus = true,
    bindKeys = true,
    header = null,
}) {
    const [scrollTop, setScrollTop] = useState(0);
    const [, bump] = useState(0);

    const termRows = process.stdout.rows || 24;
    const viewportRows = Math.max(
        4,
        maxHeight != null ? Math.floor(maxHeight) : Math.max(8, termRows - 8),
    );

    // Match ScreenContainer inner width: container is term-4, minus border+paddingX → term-8
    // (same heuristic as ListComponent / ScreenDivider).
    const contentCols = Math.max(20, getScreenWidth() - 4);
    // Always reserve the bar column when enabled so wrap width does not jump when overflow starts.
    const barCols = showScrollbar ? 1 : 0;
    const textWidth = Math.max(8, contentCols - barCols);

    const allLines = useMemo(() => {
        if (Array.isArray(linesProp)) return linesProp.map((l) => String(l ?? ""));
        return wrap ? wrapTextLines(text, textWidth) : String(text ?? "").split("\n");
    }, [linesProp, text, wrap, textWidth]);

    const needsBar = showScrollbar && allLines.length > viewportRows;
    const maxScroll = Math.max(0, allLines.length - viewportRows);
    const clamped = Math.min(Math.max(0, scrollTop), maxScroll);
    const visible = allLines.slice(clamped, clamped + viewportRows);
    const bar = needsBar ? scrollbarGlyphs(viewportRows, allLines.length, clamped) : null;

    useEffect(() => {
        setScrollTop((s) => Math.min(s, maxScroll));
    }, [maxScroll]);

    const maxScrollRef = useRef(maxScroll);
    const pageSizeRef = useRef(viewportRows);
    maxScrollRef.current = maxScroll;
    pageSizeRef.current = viewportRows;

    useEffect(() => {
        if (!ctx || !bindKeys) return undefined;

        ctx.setKeyBinding(SCROLL_KEYS);

        ctx.setAction("scrollUp", () => {
            setScrollTop((s) => Math.max(0, s - 1));
            bump((n) => n + 1);
            ctx.update?.();
        });
        ctx.setAction("scrollDown", () => {
            setScrollTop((s) => Math.min(maxScrollRef.current, s + 1));
            bump((n) => n + 1);
            ctx.update?.();
        });
        ctx.setAction("pageUp", () => {
            setScrollTop((s) => Math.max(0, s - pageSizeRef.current));
            bump((n) => n + 1);
            ctx.update?.();
        });
        ctx.setAction("pageDown", () => {
            setScrollTop((s) => Math.min(maxScrollRef.current, s + pageSizeRef.current));
            bump((n) => n + 1);
            ctx.update?.();
        });

        return undefined;
    }, [ctx, bindKeys]);

    const status =
        allLines.length === 0
            ? "empty"
            : `lines ${clamped + 1}-${Math.min(clamped + visible.length, allLines.length)} of ${allLines.length}` +
              (needsBar ? " · ⌥↑/↓ or PgUp/Dn page" : "");

    // Single Text per row (not a row Box): avoids yoga width surprises; ASCII bar is 1 cell.
    const rowNodes = visible.map((line, i) => {
        const body = padEndVisible(line, textWidth);
        const glyph = bar ? bar[i] ?? BAR_TRACK : showScrollbar ? " " : "";
        const isThumb = glyph === BAR_THUMB;
        return h(
            Text,
            { key: `L${clamped + i}` },
            body,
            glyph
                ? h(Text, { color: isThumb ? "cyan" : "gray" }, glyph)
                : null,
        );
    });

    // Pad short final page so the scrollbar track stays full height.
    if (bar && visible.length < viewportRows) {
        for (let i = visible.length; i < viewportRows; i++) {
            const glyph = bar[i] ?? BAR_TRACK;
            rowNodes.push(
                h(
                    Text,
                    { key: `pad${i}` },
                    padEndVisible("", textWidth),
                    h(Text, { color: glyph === BAR_THUMB ? "cyan" : "gray" }, glyph),
                ),
            );
        }
    }

    return h(
        Box,
        { flexDirection: "column" },
        header == null
            ? null
            : typeof header === "string"
              ? h(Text, { color: "gray" }, header)
              : header,
        showStatus ? h(Text, { color: "gray" }, status) : null,
        ...rowNodes,
    );
}
