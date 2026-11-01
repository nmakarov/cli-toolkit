import { describe, it, expect } from "vitest";
import { bindingMatchesInput } from "../key-bindings.js";

describe("bindingMatchesInput", () => {
    it("matches Ink Escape even though useInput always sets meta", () => {
        // ink/build/hooks/use-input.js: meta ||= name === "escape"
        expect(
            bindingMatchesInput({ key: "escape", action: "back" }, "", {
                escape: true,
                meta: true,
            }),
        ).toBe(true);
        expect(
            bindingMatchesInput({ key: "escape", action: "back" }, "", {
                escape: true,
                meta: false,
            }),
        ).toBe(true);
        expect(
            bindingMatchesInput({ key: "leftArrow", action: "back" }, "", {
                leftArrow: true,
                meta: false,
            }),
        ).toBe(true);
        expect(
            bindingMatchesInput({ key: "leftArrow", action: "back" }, "", {
                leftArrow: true,
                meta: true,
            }),
        ).toBe(false);
    });

    it("matches a space binding from the space character Ink passes", () => {
        expect(bindingMatchesInput({ key: "space", action: "toggle" }, " ", {})).toBe(true);
        expect(bindingMatchesInput({ key: " ", action: "toggle" }, " ", {})).toBe(true);
        expect(
            bindingMatchesInput({ key: "space", action: "toggle" }, " ", { meta: true }),
        ).toBe(false);
        expect(bindingMatchesInput({ key: "space", action: "toggle" }, "x", {})).toBe(false);
    });
});
