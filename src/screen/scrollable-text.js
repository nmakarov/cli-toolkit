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
import { getScreenBodyRows } from "./screen-layout.js";
import {
    BAR_THUMB,
    BAR_TRACK,
    PAGE_SCROLL_KEY_BINDINGS,
    scrollbarGlyphs,
} from "./scrollbar.js";
import { nextScrollAfterContentChange, nextScrollAfterUserMove } from "./follow-scroll.js";
import { padEndVisible, wrapTextLines } from "./visible-text.js";

export { scrollbarGlyphs } from "./scrollbar.js";
export { wrapTextLines } from "./visible-text.js";

const h = createElement;

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
 *   reserveRows?: number,
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
    reserveRows = 0,
}) {
    const [scrollTop, setScrollTop] = useState(0);
    const [following, setFollowing] = useState(() => !!followBottom);

    const extraRows = (header == null ? 0 : 1) + (showStatus ? 1 : 0) + (Number(reserveRows) || 0);
    const viewportRows = Math.max(
        4,
        maxHeight != null ? Math.floor(maxHeight) : getScreenBodyRows({ extraRows }),
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
        // Do not ctx.update() — that remounts the bordered Screen and flashes.
        // Slot keys stay `slot-i` so Ink patches line text in place (like less).
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

    // Fixed-width rows + stable slot keys: scrolling updates text, does not remount.
    // Always emit `viewportRows` slots so the pane height (and Screen border) stay put.
    const rowNodes = [];
    for (let i = 0; i < viewportRows; i++) {
        const line = visible[i] ?? "";
        const glyph = bar ? bar[i] ?? BAR_TRACK : showScrollbar ? " " : "";
        const isThumb = glyph === BAR_THUMB;
        rowNodes.push(
            h(
                Box,
                { key: `slot-${i}`, flexDirection: "row", width: contentCols, flexShrink: 0 },
                h(
                    Box,
                    { width: textWidth, flexShrink: 0 },
                    h(Text, { wrap: "truncate" }, padEndVisible(line, textWidth)),
                ),
                showScrollbar
                    ? h(Box, { width: 1, flexShrink: 0 }, h(Text, { color: isThumb ? "cyan" : "gray" }, glyph))
                    : null,
            ),
        );
    }

    return h(
        Box,
        { flexDirection: "column", overflow: "hidden" },
        header == null
            ? null
            : typeof header === "string"
              ? h(Text, { color: "gray" }, header)
              : header,
        showStatus ? h(Text, { color: "gray" }, status) : null,
        ...rowNodes,
    );
}
