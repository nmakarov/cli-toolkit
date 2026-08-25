import { describe, it, expect } from "vitest";
import {
    inkEraseLines,
    splitInkLogWrite,
    splitFrameLines,
    contentRows,
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

describe("contentRows", () => {
    it("drops the trailing empty slot from Ink's final newline", () => {
        expect(contentRows(["a", "b", ""])).toEqual(["a", "b"]);
        expect(contentRows(["a"])).toEqual(["a"]);
        expect(contentRows([""])).toEqual([]);
    });
});

describe("paintFrameDiff", () => {
    it("moves up by content rows, not split length (trailing newline)", () => {
        const prev = splitFrameLines("aaaa\nbbbb\ncccc\n");
        const next = splitFrameLines("aaaa\nBBBB\ncccc\n");
        expect(prev).toEqual(["aaaa", "bbbb", "cccc", ""]);
        const painted = paintFrameDiff(prev, next);
        expect(painted).toContain("\u001b[3A");
        expect(painted).not.toContain("\u001b[4A");
        expect(painted).toContain("BBBB");
        expect(painted).not.toContain("aaaa");
        expect(painted).not.toContain(inkEraseLines(4));
        expect(painted).not.toContain("\u001b[?2026h");
    });

    it("erases leftover lines when the frame shrinks and parks after last content", () => {
        const painted = paintFrameDiff(
            splitFrameLines("a\nb\nc\n"),
            splitFrameLines("a\n"),
        );
        expect(painted).toContain("\u001b[3A");
        expect(painted.match(/\u001b\[2K/g)?.length).toBe(2);
        expect(painted).toContain("\u001b[1A");
    });
});

describe("createFlickerFreeStdout", () => {
    it("first write is stored; second write diffs without a full erase", () => {
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
        expect(writes[0]).toBe("one\ntwo\n");
        writes.length = 0;

        out.write(inkEraseLines(3) + "one\nTWO\n");
        const frame = writes[0];
        expect(splitInkLogWrite(frame).kind).not.toBe("frame");
        expect(frame).toContain("TWO");
        expect(frame).toContain("\u001b[2A");
        expect(frame).not.toContain(inkEraseLines(3));
    });

    it("exposes live columns/rows getters from the real stream", () => {
        let columns = 120;
        const fake = {
            write() { return true; },
            get columns() { return columns; },
            get rows() { return 40; },
            on() {},
            off() {},
        };
        const out = createFlickerFreeStdout(fake);
        expect(out.columns).toBe(120);
        columns = 40;
        expect(out.columns).toBe(40);
        expect(out.rows).toBe(40);
    });

    it("does not rewrite later raw multiline writes (not an Ink frame)", () => {
        const writes = [];
        const fake = {
            write(chunk) {
                writes.push(String(chunk));
                return true;
            },
        };
        const out = createFlickerFreeStdout(fake);
        out.write("one\ntwo\n");
        writes.length = 0;
        out.write("side\nchannel\n");
        expect(writes[0]).toBe("side\nchannel\n");
    });
});
