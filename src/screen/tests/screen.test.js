import { describe, it, expect } from "vitest";
import {
    formatKeyBindings,
    styleFooterHotkey,
} from "../screens.js";
import { stripAnsi } from "../visible-text.js";

function visibleOf(node) {
    if (node == null || typeof node === "boolean") return "";
    if (typeof node === "string" || typeof node === "number") return stripAnsi(node);
    if (Array.isArray(node)) return node.map(visibleOf).join("");
    if (typeof node === "object" && node.props?.children !== undefined) {
        return visibleOf(node.props.children);
    }
    return "";
}

describe("Screen", () => {
    it("builds footer phrases in long mode with highlighted keys", () => {
        const bindings = [
            { key: "escape", caption: "go back", action: "back", order: 1 },
            { key: "return", caption: "select", action: "select", order: 2 }
        ] ;

        const items = formatKeyBindings(bindings, "long");
        expect(items.map(visibleOf)).toEqual([
            "esc to go back",
            "enter to select"
        ]);
        expect(items[0]).toContain(styleFooterHotkey("esc"));
        expect(items[1]).toContain(styleFooterHotkey("enter"));
    });

    it("highlights every key in a grouped binding", () => {
        const items = formatKeyBindings(
            [
                { key: "escape", caption: "go back", action: "back", order: 1 },
                { key: "leftArrow", caption: "go back", action: "back", order: 1 },
                { key: "return", caption: "inspect", action: "inspect", order: 2 },
                { key: "r", caption: "refresh", action: "refresh", order: 3 },
            ],
            "long",
        );
        expect(items.map(visibleOf)).toEqual([
            "esc/← to go back",
            "enter to inspect",
            "r to refresh",
        ]);
        for (const label of ["esc", "←", "enter", "r"]) {
            expect(
                items.some((item) => typeof item === "string" && item.includes(styleFooterHotkey(label))),
                label,
            ).toBe(true);
        }
    });

    it("supports short mode output", () => {
        const bindings = [
            { key: "upArrow", caption: "navigate", action: "up" },
            { key: "downArrow", caption: "navigate", action: "down" }
        ] ;

        const items = formatKeyBindings(bindings, "short");
        expect(items.map(visibleOf)).toEqual(["↑/↓"]);
        expect(items[0]).toContain(styleFooterHotkey("↑"));
        expect(items[0]).toContain(styleFooterHotkey("↓"));
    });
});
