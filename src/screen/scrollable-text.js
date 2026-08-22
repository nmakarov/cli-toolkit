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
import {
    BAR_THUMB,
    BAR_TRACK,
    PAGE_SCROLL_KEY_BINDINGS,
    scrollbarGlyphs,
} from "./scrollbar.js";
import { nextScrollAfterContentChange, nextScrollAfterUserMove } from "./follow-scroll.js";

export { scrollbarGlyphs } from "./scrollbar.js";

const h = createElement;

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

function padEndVisible(s, w) {
    const t = String(s ?? "");
    if (t.length >= w) return t.slice(0, w);
    return t + " ".repeat(w - t.length);
}

const SCROLL_KEYS = [
    { key: "upArrow", caption: "scroll", action: "scrollUp", order: 0 },
    { key: "downArrow", caption: "scroll", action: "scrollDown", order: 0 },
    ...PAGE_SCROLL_KEY_BINDINGS,
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
 *   followBottom?: boolean,
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
    followBottom = false,
}) {
    const [scrollTop, setScrollTop] = useState(0);
    const [following, setFollowing] = useState(() => !!followBottom);
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

    const maxScrollRef = useRef(maxScroll);
    const pageSizeRef = useRef(viewportRows);
    const scrollTopRef = useRef(scrollTop);
    const followingRef = useRef(following);
    maxScrollRef.current = maxScroll;
    pageSizeRef.current = viewportRows;
    scrollTopRef.current = scrollTop;
    followingRef.current = following;

    useEffect(() => {
        const next = nextScrollAfterContentChange({
            following: followBottom && followingRef.current,
            scrollTop: scrollTopRef.current,
            maxScroll,
        });
        if (next.scrollTop !== scrollTopRef.current) setScrollTop(next.scrollTop);
        if (followBottom && next.following !== followingRef.current) setFollowing(next.following);
    }, [maxScroll, followBottom]);

    const applyUserScroll = (delta) => {
        const next = nextScrollAfterUserMove(scrollTopRef.current, maxScrollRef.current, delta);
        setScrollTop(next.scrollTop);
        if (followBottom) setFollowing(next.following);
        bump((n) => n + 1);
        ctx?.update?.();
    };

    useEffect(() => {
        if (!ctx || !bindKeys) return undefined;

        ctx.setKeyBinding(SCROLL_KEYS);

        ctx.setAction("scrollUp", () => applyUserScroll(-1));
        ctx.setAction("scrollDown", () => applyUserScroll(1));
        ctx.setAction("pageUp", () => applyUserScroll(-pageSizeRef.current));
        ctx.setAction("pageDown", () => applyUserScroll(pageSizeRef.current));

        return undefined;
    }, [ctx, bindKeys, followBottom]);

    const status =
        allLines.length === 0
            ? "empty"
            : `lines ${clamped + 1}-${Math.min(clamped + visible.length, allLines.length)} of ${allLines.length}` +
              (needsBar ? " · ⌥↑/↓ or PgUp/Dn page" : "") +
              (followBottom && following ? " · follow" : followBottom ? " · follow off" : "");

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
