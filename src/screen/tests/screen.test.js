import { describe, it, expect } from "vitest";
import { bindingsToFooterHotkeys } from "../screens.js";
import { ScreenFooter, FOOTER_HOTKEY_STYLE, FOOTER_MUTED_STYLE } from "../components.js";

function walk(node, acc = []) {
    if (node == null || typeof node === "boolean") return acc;
    if (typeof node === "string" || typeof node === "number") return acc;
    if (Array.isArray(node)) {
        node.forEach((kid) => walk(kid, acc));
        return acc;
    }
    if (typeof node === "object") {
        acc.push(node);
        walk(node.props?.children, acc);
    }
    return acc;
}

function visibleOf(node) {
    if (node == null || typeof node === "boolean") return "";
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(visibleOf).join("");
    if (typeof node === "object" && node.props?.children !== undefined) {
        return visibleOf(node.props.children);
    }
    return "";
}

describe("Screen footer hotkeys", () => {
    it("builds structured items from key bindings", () => {
        const items = bindingsToFooterHotkeys([
            { key: "escape", caption: "go back", action: "back", order: 1 },
            { key: "leftArrow", caption: "go back", action: "back", order: 1 },
            { key: "return", caption: "select", action: "select", order: 2 },
        ]);
        expect(items).toEqual([
            { hotkey: ["esc", "←"], caption: "go back", order: 1 },
            { hotkey: ["enter"], caption: "select", order: 2 },
        ]);
    });

    it("styles every hotkey in ScreenFooter, not only the first", () => {
        const hotkeys = bindingsToFooterHotkeys(
            [
                { key: "escape", caption: "go back", action: "back", order: 1 },
                { key: "leftArrow", caption: "go back", action: "back", order: 1 },
                { key: "return", caption: "inspect", action: "inspect", order: 2 },
                { key: "r", caption: "refresh", action: "refresh", order: 3 },
            ],
            "long",
        );
        const tree = ScreenFooter({ hotkeys });
        expect(visibleOf(tree)).toBe("esc/← to go back, enter to inspect, r to refresh");

        const nodes = walk(tree);
        for (const label of ["esc", "←", "enter", "r"]) {
            const keyNode = nodes.find((n) => n.props?.children === label && n.props?.bold);
            expect(keyNode?.props, label).toMatchObject(FOOTER_HOTKEY_STYLE);
            expect(keyNode.props.dimColor).toBeUndefined();
        }
        const captions = nodes.filter((n) => typeof n.props?.children === "string" && n.props.children.startsWith(" to "));
        expect(captions.length).toBe(3);
        for (const cap of captions) {
            expect(cap.props).toMatchObject(FOOTER_MUTED_STYLE);
            expect(cap.props.dimColor).toBeUndefined();
        }
    });

    it("omits captions in short mode and renders toggle values", () => {
        const short = bindingsToFooterHotkeys(
            [
                { key: "upArrow", caption: "navigate", action: "up" },
                { key: "downArrow", caption: "navigate", action: "down" },
            ],
            "short",
        );
        expect(short).toEqual([
            { hotkey: ["↑", "↓"], caption: "", order: 999 },
        ]);
        expect(visibleOf(ScreenFooter({ hotkeys: short }))).toBe("↑/↓");

        const toggle = bindingsToFooterHotkeys([
            { key: "s", caption: "toggle sort", action: "toggleSort", kind: "toggle", value: "ASC" },
        ]);
        expect(toggle[0]).toMatchObject({ hotkey: ["s"], caption: "toggle sort", kind: "toggle", value: "ASC" });
        expect(visibleOf(ScreenFooter({ hotkeys: toggle }))).toBe("s to toggle sort  ASC ");
    });
});
