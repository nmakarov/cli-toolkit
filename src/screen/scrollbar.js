/**
 * Shared proportional scrollbar (ASCII — block glyphs are often double-width).
 */

export const BAR_THUMB = "#";
export const BAR_TRACK = "|";

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

/** ⌥/Ctrl + arrows and PgUp/PgDn → pageUp / pageDown actions. */
export const PAGE_SCROLL_KEY_BINDINGS = [
    { key: "upArrow", meta: true, caption: "page", action: "pageUp", order: 0 },
    { key: "downArrow", meta: true, caption: "page", action: "pageDown", order: 0 },
    { key: "upArrow", ctrl: true, caption: "page", action: "pageUp", order: 0 },
    { key: "downArrow", ctrl: true, caption: "page", action: "pageDown", order: 0 },
    { key: "pageUp", caption: "page", action: "pageUp", order: 0 },
    { key: "pageDown", caption: "page", action: "pageDown", order: 0 },
];
