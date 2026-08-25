import { describe, it, expect } from "vitest";
import {
    inkEraseLines,
    splitInkLogWrite,
    splitFrameLines,
    paintFrameDiff,
    createFlickerFreeStdout,
} from "../flicker-free-stdout.js";

describe("splitInkLogWrite", () => {
    it("detects Ink eraseLines + body as a frame", () => {
        const body = "hello\nworld\n";
        const parsed = splitInkLogWrite(inkEraseLines(3) + body);
        expect(parsed.kind).toBe("frame");
        expect(parsed.body).toBe(body);
    });

    it("treats a first paint (no erase) as raw", () => {
        expect(splitInkLogWrite("title\nbody\n")).toEqual({
            kind: "raw",
            body: "title\nbody\n",
        });
    });

    it("passes cursor hide through as raw", () => {
        expect(splitInkLogWrite("\u001b[?25l").kind).toBe("raw");
    });
});

describe("paintFrameDiff", () => {
    it("does not blank the whole frame when one line changes", () => {
        const prev = ["aaaa", "bbbb", "cccc", ""];
        const next = ["aaaa", "BBBB", "cccc", ""];
        const painted = paintFrameDiff(prev, next);
        expect(painted.startsWith("\u001b[?2026h")).toBe(true);
        expect(painted.endsWith("\u001b[?2026l")).toBe(true);
        expect(painted).toContain("\u001b[4A");
        expect(painted).toContain("BBBB");
        expect(painted).not.toContain("aaaa");
        expect(painted).not.toContain(inkEraseLines(4));
    });

    it("erases leftover lines when the frame shrinks", () => {
        const painted = paintFrameDiff(["a", "b", "c"], ["a"]);
        expect(painted).toContain("\u001b[2K");
        expect(painted.match(/\u001b\[2K/g)?.length).toBeGreaterThanOrEqual(2);
    });
});

describe("createFlickerFreeStdout", () => {
    it("first write is stored; second write diffs", () => {
        const writes = [];
        const fake = {
            write(chunk) {
                writes.push(String(chunk));
                return true;
            },
            columns: 80,
            rows: 24,
            isTTY: true,
            on() {},
            off() {},
        };
        const out = createFlickerFreeStdout(fake);
        out.write("one\ntwo\n");
        expect(writes[0]).toContain("one\ntwo\n");
        writes.length = 0;

        out.write(inkEraseLines(3) + "one\nTWO\n");
        const frame = writes[0];
        expect(splitInkLogWrite(frame).kind).not.toBe("frame");
        expect(frame).toContain("TWO");
        expect(frame).not.toContain(inkEraseLines(3));
        expect(splitFrameLines("one\nTWO\n")).toEqual(["one", "TWO", ""]);
    });
});
