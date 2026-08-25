import { describe, it, expect } from "vitest";
import { nextTextInputValue, sanitizeTextInput } from "../text-input.js";

describe("sanitizeTextInput", () => {
    it("strips bracketed-paste markers and leftover CSI after Ink drops ESC", () => {
        expect(sanitizeTextInput("\u001b[200~abc-123\u001b[201~")).toBe("abc-123");
        expect(sanitizeTextInput("[200~abc-123[201~")).toBe("abc-123");
    });

    it("drops newlines by default so paste does not submit", () => {
        expect(sanitizeTextInput("a\r\nb\nc")).toBe("abc");
        expect(sanitizeTextInput("a\nb", { allowNewlines: true })).toBe("a\nb");
    });
});

describe("nextTextInputValue", () => {
    const none = {
        return: false,
        escape: false,
        ctrl: false,
        backspace: false,
        delete: false,
    };

    it("appends a paste of more than one character", () => {
        expect(nextTextInputValue("id=", "fd16087c-af2a", none)).toBe("id=fd16087c-af2a");
    });

    it("treats backspace as delete-last, not insert", () => {
        expect(nextTextInputValue("abc", "", { ...none, backspace: true })).toBe("ab");
    });

    it("ignores Enter / Esc / arrows", () => {
        expect(nextTextInputValue("ab", "\r", { ...none, return: true })).toBeNull();
        expect(nextTextInputValue("ab", "", { ...none, escape: true })).toBeNull();
        expect(nextTextInputValue("ab", "", { ...none, leftArrow: true })).toBeNull();
    });

    it("filters paste through accept", () => {
        expect(nextTextInputValue("1", "2a3", none, { accept: /\d/ })).toBe("123");
    });
});
