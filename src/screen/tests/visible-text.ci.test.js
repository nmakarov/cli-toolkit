import { describe, it, expect } from "vitest";
import { padEndVisible, sliceVisible, stripAnsi, visibleWidth, wrapTextLines } from "../visible-text.js";

const red = (s) => `\u001b[31m${s}\u001b[0m`;

describe("visible-text", () => {
    it("ignores ANSI when measuring", () => {
        expect(stripAnsi(red("hi"))).toBe("hi");
        expect(visibleWidth(red("hi"))).toBe(2);
        expect(visibleWidth("hi")).toBe(2);
    });

    it("pads and slices to a visible column count", () => {
        expect(padEndVisible("ab", 4)).toBe("ab  ");
        expect(visibleWidth(padEndVisible(red("ab"), 4))).toBe(4);
        expect(sliceVisible(red("abcdef"), 2)).toBe("\u001b[31mab");
        expect(visibleWidth(padEndVisible(red("abcdef"), 3))).toBe(3);
    });

    it("wraps on visible width, not raw string length", () => {
        expect(wrapTextLines("abcd", 2)).toEqual(["ab", "cd"]);
        expect(wrapTextLines(red("abcd"), 2).map(visibleWidth)).toEqual([2, 2]);
        expect(wrapTextLines(red("abcd"), 2).map(stripAnsi)).toEqual(["ab", "cd"]);
    });
});
