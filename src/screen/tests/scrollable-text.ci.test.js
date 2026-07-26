import { describe, it, expect } from "vitest";
import { wrapTextLines, scrollbarGlyphs } from "../scrollable-text.js";
import {
    bindingIdentity,
    bindingMatchesInput,
    formatBindingKey,
} from "../key-bindings.js";

describe("wrapTextLines", () => {
    it("wraps long lines and keeps blanks", () => {
        expect(wrapTextLines("abcd", 2)).toEqual(["ab", "cd"]);
        expect(wrapTextLines("a\n\nbc", 10)).toEqual(["a", "", "bc"]);
    });
});

describe("scrollbarGlyphs", () => {
    it("returns null when content fits", () => {
        expect(scrollbarGlyphs(10, 5, 0)).toBeNull();
        expect(scrollbarGlyphs(10, 10, 0)).toBeNull();
    });

    it("places a proportional thumb", () => {
        const top = scrollbarGlyphs(10, 100, 0);
        expect(top).toHaveLength(10);
        expect(top.filter((g) => g === "█").length).toBeGreaterThanOrEqual(1);
        expect(top[0]).toBe("█");

        const bottom = scrollbarGlyphs(10, 100, 90);
        expect(bottom[bottom.length - 1]).toBe("█");
        expect(bottom[0]).toBe("│");
    });
});

describe("key binding modifiers", () => {
    it("distinguishes plain ↑ from ⌥↑", () => {
        const plain = { key: "upArrow" };
        const meta = { key: "upArrow", meta: true };
        expect(bindingIdentity(plain)).not.toBe(bindingIdentity(meta));

        expect(bindingMatchesInput(plain, "", { upArrow: true })).toBe(true);
        expect(bindingMatchesInput(plain, "", { upArrow: true, meta: true })).toBe(false);
        expect(bindingMatchesInput(meta, "", { upArrow: true, meta: true })).toBe(true);
        expect(bindingMatchesInput(meta, "", { upArrow: true })).toBe(false);
    });

    it("formats modifier labels", () => {
        expect(formatBindingKey({ key: "upArrow" })).toBe("↑");
        expect(formatBindingKey({ key: "upArrow", meta: true })).toBe("⌥↑");
        expect(formatBindingKey({ key: "downArrow", ctrl: true })).toBe("^↓");
        expect(formatBindingKey({ key: "pageUp" })).toBe("PgUp");
    });
});
