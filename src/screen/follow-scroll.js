/**
 * Tail-follow helpers for ScrollableText.
 * Follow while the viewport is pinned to the last line; leave follow on
 * scroll-up; resume when the user scrolls back to the bottom.
 */

export function clampScroll(scrollTop, maxScroll) {
    const max = Math.max(0, Number(maxScroll) || 0);
    const top = Number(scrollTop) || 0;
    return Math.min(Math.max(0, top), max);
}

export function isScrolledToBottom(scrollTop, maxScroll) {
    return clampScroll(scrollTop, maxScroll) >= Math.max(0, Number(maxScroll) || 0);
}

export function nextScrollAfterUserMove(scrollTop, maxScroll, delta) {
    const next = clampScroll((Number(scrollTop) || 0) + (Number(delta) || 0), maxScroll);
    return { scrollTop: next, following: isScrolledToBottom(next, maxScroll) };
}

export function nextScrollAfterContentChange({ following, scrollTop, maxScroll }) {
    const max = Math.max(0, Number(maxScroll) || 0);
    if (following) return { scrollTop: max, following: true };
    const next = clampScroll(scrollTop, max);
    return { scrollTop: next, following: isScrolledToBottom(next, max) };
}
