import { describe, it, expect } from "vitest";
import { formatKeyBindings } from "../screens.js";

describe("Screen", () => {
    it("builds footer strings in long mode", () => {
        const bindings = [
            { key: "escape", caption: "go back", action: "back", order: 1 },
            { key: "return", caption: "select", action: "select", order: 2 }
        ] as any;

        expect(formatKeyBindings(bindings, "long")).toEqual([
            "esc to go back",
            "enter to select"
        ]);
    });

    it("supports short mode output", () => {
        const bindings = [
            { key: "upArrow", caption: "navigate", action: "up" },
            { key: "downArrow", caption: "navigate", action: "down" }
        ] as any;

        expect(formatKeyBindings(bindings, "short")).toEqual(["↑/↓"]);
    });
});


