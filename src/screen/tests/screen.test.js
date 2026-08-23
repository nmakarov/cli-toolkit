import { describe, it, expect } from "vitest";
import { formatKeyBindings, FOOTER_HOTKEY_STYLE } from "../screens.js";

function textOf(node) {
    if (node == null || typeof node === "boolean") return "";
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(textOf).join("");
    if (typeof node === "object" && node.props?.children !== undefined) {
        return textOf(node.props.children);
    }
    return "";
}

function findStyled(node, pred) {
    if (!node || typeof node !== "object") return null;
    if (pred(node)) return node;
    const kids = Array.isArray(node.props?.children)
        ? node.props.children
        : node.props?.children != null
          ? [node.props.children]
          : [];
    for (const kid of kids) {
        const found = findStyled(kid, pred);
        if (found) return found;
    }
    return null;
}

describe("Screen", () => {
    it("builds footer phrases in long mode with highlighted keys", () => {
        const bindings = [
            { key: "escape", caption: "go back", action: "back", order: 1 },
            { key: "return", caption: "select", action: "select", order: 2 }
        ] ;

        const items = formatKeyBindings(bindings, "long");
        expect(items.map(textOf)).toEqual([
            "esc to go back",
            "enter to select"
        ]);
        const escKey = findStyled(items[0], (n) => n.props?.children === "esc");
        expect(escKey?.props).toMatchObject(FOOTER_HOTKEY_STYLE);
    });

    it("supports short mode output", () => {
        const bindings = [
            { key: "upArrow", caption: "navigate", action: "up" },
            { key: "downArrow", caption: "navigate", action: "down" }
        ] ;

        const items = formatKeyBindings(bindings, "short");
        expect(items.map(textOf)).toEqual(["↑/↓"]);
        expect(items[0].props).toMatchObject(FOOTER_HOTKEY_STYLE);
    });
});


