import { describe, it, expect } from "vitest";
import {
    clampScroll,
    isScrolledToBottom,
    nextScrollAfterUserMove,
    nextScrollAfterContentChange,
} from "../follow-scroll.js";

describe("follow-scroll", () => {
    it("clamps and detects the bottom", () => {
        expect(clampScroll(-3, 10)).toBe(0);
        expect(clampScroll(99, 10)).toBe(10);
        expect(isScrolledToBottom(10, 10)).toBe(true);
        expect(isScrolledToBottom(9, 10)).toBe(false);
        expect(isScrolledToBottom(0, 0)).toBe(true);
    });

    it("leaves follow when scrolling up and resumes at the bottom", () => {
        expect(nextScrollAfterUserMove(10, 10, -1)).toEqual({ scrollTop: 9, following: false });
        expect(nextScrollAfterUserMove(9, 10, 1)).toEqual({ scrollTop: 10, following: true });
        expect(nextScrollAfterUserMove(8, 10, 20)).toEqual({ scrollTop: 10, following: true });
    });

    it("pins to the new bottom while following, stays put otherwise", () => {
        expect(nextScrollAfterContentChange({ following: true, scrollTop: 10, maxScroll: 14 })).toEqual({
            scrollTop: 14,
            following: true,
        });
        expect(nextScrollAfterContentChange({ following: false, scrollTop: 4, maxScroll: 14 })).toEqual({
            scrollTop: 4,
            following: false,
        });
        expect(nextScrollAfterContentChange({ following: false, scrollTop: 14, maxScroll: 12 })).toEqual({
            scrollTop: 12,
            following: true,
        });
    });
});
